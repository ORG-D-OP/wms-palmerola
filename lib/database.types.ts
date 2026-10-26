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
    PostgrestVersion: "14.18"
  }
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
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          id: number
          new_value: Json | null
          occurred_at: string
          old_value: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          id?: never
          new_value?: Json | null
          occurred_at?: string
          old_value?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          id?: never
          new_value?: Json | null
          occurred_at?: string
          old_value?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      barcode: {
        Row: {
          code: string
          created_at: string
          id: string
          is_primary: boolean
          packaging_level_id: string
          symbology: Database["public"]["Enums"]["barcode_symbology"]
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_primary?: boolean
          packaging_level_id: string
          symbology: Database["public"]["Enums"]["barcode_symbology"]
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          packaging_level_id?: string
          symbology?: Database["public"]["Enums"]["barcode_symbology"]
        }
        Relationships: [
          {
            foreignKeyName: "barcode_packaging_level_id_fkey"
            columns: ["packaging_level_id"]
            isOneToOne: false
            referencedRelation: "packaging_level"
            referencedColumns: ["id"]
          },
        ]
      }
      box_type: {
        Row: {
          code: string
          is_returnable: boolean
          name: string
        }
        Insert: {
          code: string
          is_returnable?: boolean
          name: string
        }
        Update: {
          code?: string
          is_returnable?: boolean
          name?: string
        }
        Relationships: []
      }
      dock_door: {
        Row: {
          code: string
          coord_x: number | null
          coord_y: number | null
          direction: Database["public"]["Enums"]["dock_direction"]
          id: string
          is_active: boolean
          site_id: string
        }
        Insert: {
          code: string
          coord_x?: number | null
          coord_y?: number | null
          direction: Database["public"]["Enums"]["dock_direction"]
          id?: string
          is_active?: boolean
          site_id: string
        }
        Update: {
          code?: string
          coord_x?: number | null
          coord_y?: number | null
          direction?: Database["public"]["Enums"]["dock_direction"]
          id?: string
          is_active?: boolean
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dock_door_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site"
            referencedColumns: ["id"]
          },
        ]
      }
      lane: {
        Row: {
          aisle_code: string | null
          code: string
          depth: number
          id: string
          zone_id: string
        }
        Insert: {
          aisle_code?: string | null
          code: string
          depth?: number
          id?: string
          zone_id: string
        }
        Update: {
          aisle_code?: string | null
          code?: string
          depth?: number
          id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lane_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zone"
            referencedColumns: ["id"]
          },
        ]
      }
      location: {
        Row: {
          barcode: string
          code: string
          coord_x: number | null
          coord_y: number | null
          coord_z: number | null
          created_at: string
          depth_index: number
          id: string
          kind: Database["public"]["Enums"]["location_type"]
          lane_id: string
          level: number
          max_height_mm: number | null
          max_pallets_stacked: number | null
          max_weight_kg: number | null
          pick_sequence: number | null
          retired_at: string | null
          status: Database["public"]["Enums"]["location_status"]
          updated_at: string
        }
        Insert: {
          barcode: string
          code: string
          coord_x?: number | null
          coord_y?: number | null
          coord_z?: number | null
          created_at?: string
          depth_index?: number
          id?: string
          kind: Database["public"]["Enums"]["location_type"]
          lane_id: string
          level?: number
          max_height_mm?: number | null
          max_pallets_stacked?: number | null
          max_weight_kg?: number | null
          pick_sequence?: number | null
          retired_at?: string | null
          status?: Database["public"]["Enums"]["location_status"]
          updated_at?: string
        }
        Update: {
          barcode?: string
          code?: string
          coord_x?: number | null
          coord_y?: number | null
          coord_z?: number | null
          created_at?: string
          depth_index?: number
          id?: string
          kind?: Database["public"]["Enums"]["location_type"]
          lane_id?: string
          level?: number
          max_height_mm?: number | null
          max_pallets_stacked?: number | null
          max_weight_kg?: number | null
          pick_sequence?: number | null
          retired_at?: string | null
          status?: Database["public"]["Enums"]["location_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lane"
            referencedColumns: ["id"]
          },
        ]
      }
      lpn: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          status: Database["public"]["Enums"]["lpn_status"]
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          status?: Database["public"]["Enums"]["lpn_status"]
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          status?: Database["public"]["Enums"]["lpn_status"]
        }
        Relationships: []
      }
      packaging_level: {
        Row: {
          box_type_code: string | null
          code: Database["public"]["Enums"]["packaging_code"]
          gross_weight_g: number | null
          height_mm: number | null
          id: string
          is_pick_unit: boolean
          is_receipt_unit: boolean
          length_mm: number | null
          net_weight_g: number | null
          product_id: string
          qty_base_units: number
          width_mm: number | null
        }
        Insert: {
          box_type_code?: string | null
          code: Database["public"]["Enums"]["packaging_code"]
          gross_weight_g?: number | null
          height_mm?: number | null
          id?: string
          is_pick_unit?: boolean
          is_receipt_unit?: boolean
          length_mm?: number | null
          net_weight_g?: number | null
          product_id: string
          qty_base_units: number
          width_mm?: number | null
        }
        Update: {
          box_type_code?: string | null
          code?: Database["public"]["Enums"]["packaging_code"]
          gross_weight_g?: number | null
          height_mm?: number | null
          id?: string
          is_pick_unit?: boolean
          is_receipt_unit?: boolean
          length_mm?: number | null
          net_weight_g?: number | null
          product_id?: string
          qty_base_units?: number
          width_mm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packaging_level_box_type_code_fkey"
            columns: ["box_type_code"]
            isOneToOne: false
            referencedRelation: "box_type"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "packaging_level_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_level_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
        ]
      }
      pallet_config: {
        Row: {
          allows_stacking: boolean
          cases_per_layer: number
          cases_per_pallet: number | null
          id: string
          is_default: boolean
          layers: number
          max_stack: number | null
          pallet_type_code: string
          product_id: string
          total_height_mm: number | null
          total_weight_kg: number | null
        }
        Insert: {
          allows_stacking?: boolean
          cases_per_layer: number
          cases_per_pallet?: number | null
          id?: string
          is_default?: boolean
          layers: number
          max_stack?: number | null
          pallet_type_code: string
          product_id: string
          total_height_mm?: number | null
          total_weight_kg?: number | null
        }
        Update: {
          allows_stacking?: boolean
          cases_per_layer?: number
          cases_per_pallet?: number | null
          id?: string
          is_default?: boolean
          layers?: number
          max_stack?: number | null
          pallet_type_code?: string
          product_id?: string
          total_height_mm?: number | null
          total_weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pallet_config_pallet_type_code_fkey"
            columns: ["pallet_type_code"]
            isOneToOne: false
            referencedRelation: "pallet_type"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "pallet_config_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallet_config_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
        ]
      }
      pallet_type: {
        Row: {
          code: string
          height_mm: number
          length_mm: number
          name: string
          tare_weight_g: number
          width_mm: number
        }
        Insert: {
          code: string
          height_mm: number
          length_mm: number
          name: string
          tare_weight_g: number
          width_mm: number
        }
        Update: {
          code?: string
          height_mm?: number
          length_mm?: number
          name?: string
          tare_weight_g?: number
          width_mm?: number
        }
        Relationships: []
      }
      product: {
        Row: {
          base_uom: string
          brand: string | null
          category_id: string | null
          contamination_class:
            | Database["public"]["Enums"]["contamination_class"]
            | null
          created_at: string
          external_source: string | null
          humidity_sensitive: boolean
          id: string
          is_fragile: boolean
          min_days_on_dispatch: number | null
          name: string
          requires_fefo: boolean
          shelf_life_days: number | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          temp_max_c: number | null
          temp_min_c: number | null
          updated_at: string
          weight_category: Database["public"]["Enums"]["weight_category"] | null
        }
        Insert: {
          base_uom: string
          brand?: string | null
          category_id?: string | null
          contamination_class?:
            | Database["public"]["Enums"]["contamination_class"]
            | null
          created_at?: string
          external_source?: string | null
          humidity_sensitive?: boolean
          id?: string
          is_fragile?: boolean
          min_days_on_dispatch?: number | null
          name: string
          requires_fefo?: boolean
          shelf_life_days?: number | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          temp_max_c?: number | null
          temp_min_c?: number | null
          updated_at?: string
          weight_category?:
            | Database["public"]["Enums"]["weight_category"]
            | null
        }
        Update: {
          base_uom?: string
          brand?: string | null
          category_id?: string | null
          contamination_class?:
            | Database["public"]["Enums"]["contamination_class"]
            | null
          created_at?: string
          external_source?: string | null
          humidity_sensitive?: boolean
          id?: string
          is_fragile?: boolean
          min_days_on_dispatch?: number | null
          name?: string
          requires_fefo?: boolean
          shelf_life_days?: number | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          temp_max_c?: number | null
          temp_min_c?: number | null
          updated_at?: string
          weight_category?:
            | Database["public"]["Enums"]["weight_category"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "product_base_uom_fkey"
            columns: ["base_uom"]
            isOneToOne: false
            referencedRelation: "uom"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_category"
            referencedColumns: ["id"]
          },
        ]
      }
      product_category: {
        Row: {
          code: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          code: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          code?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_category_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_category"
            referencedColumns: ["id"]
          },
        ]
      }
      profile: {
        Row: {
          created_at: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_code?: string | null
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_code?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      reason_code: {
        Row: {
          affects_inventory: boolean
          category: Database["public"]["Enums"]["reason_category"]
          code: string
          description: string | null
          is_active: boolean
          ledger_account: string | null
          name: string
          requires_note: boolean
          requires_photo: boolean
          requires_supervisor: boolean
          sort_order: number
        }
        Insert: {
          affects_inventory?: boolean
          category: Database["public"]["Enums"]["reason_category"]
          code: string
          description?: string | null
          is_active?: boolean
          ledger_account?: string | null
          name: string
          requires_note?: boolean
          requires_photo?: boolean
          requires_supervisor?: boolean
          sort_order?: number
        }
        Update: {
          affects_inventory?: boolean
          category?: Database["public"]["Enums"]["reason_category"]
          code?: string
          description?: string | null
          is_active?: boolean
          ledger_account?: string | null
          name?: string
          requires_note?: boolean
          requires_photo?: boolean
          requires_supervisor?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      site: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      stock: {
        Row: {
          expiry_date: string | null
          id: string
          location_id: string
          lot: string | null
          lpn_id: string | null
          product_id: string
          qty_base: number
          updated_at: string
        }
        Insert: {
          expiry_date?: string | null
          id?: string
          location_id: string
          lot?: string | null
          lpn_id?: string | null
          product_id: string
          qty_base: number
          updated_at?: string
        }
        Update: {
          expiry_date?: string | null
          id?: string
          location_id?: string
          lot?: string | null
          lpn_id?: string | null
          product_id?: string
          qty_base?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "lpn"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movement: {
        Row: {
          actor_id: string | null
          device_id: string | null
          expiry_date: string | null
          from_location_id: string | null
          hash: string
          id: number
          idempotency_key: string | null
          lot: string | null
          lpn_id: string | null
          note: string | null
          occurred_at: string
          packaging_level_id: string | null
          prev_hash: string | null
          product_id: string
          qty_base: number
          reason_code: string | null
          task_id: string | null
          to_location_id: string | null
          type: Database["public"]["Enums"]["movement_type"]
        }
        Insert: {
          actor_id?: string | null
          device_id?: string | null
          expiry_date?: string | null
          from_location_id?: string | null
          hash: string
          id?: never
          idempotency_key?: string | null
          lot?: string | null
          lpn_id?: string | null
          note?: string | null
          occurred_at?: string
          packaging_level_id?: string | null
          prev_hash?: string | null
          product_id: string
          qty_base: number
          reason_code?: string | null
          task_id?: string | null
          to_location_id?: string | null
          type: Database["public"]["Enums"]["movement_type"]
        }
        Update: {
          actor_id?: string | null
          device_id?: string | null
          expiry_date?: string | null
          from_location_id?: string | null
          hash?: string
          id?: never
          idempotency_key?: string | null
          lot?: string | null
          lpn_id?: string | null
          note?: string | null
          occurred_at?: string
          packaging_level_id?: string | null
          prev_hash?: string | null
          product_id?: string
          qty_base?: number
          reason_code?: string | null
          task_id?: string | null
          to_location_id?: string | null
          type?: Database["public"]["Enums"]["movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "stock_movement_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "lpn"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_packaging_level_id_fkey"
            columns: ["packaging_level_id"]
            isOneToOne: false
            referencedRelation: "packaging_level"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_reason_code_fkey"
            columns: ["reason_code"]
            isOneToOne: false
            referencedRelation: "reason_code"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "stock_movement_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
        ]
      }
      uom: {
        Row: {
          code: string
          kind: Database["public"]["Enums"]["uom_kind"]
          name: string
        }
        Insert: {
          code: string
          kind: Database["public"]["Enums"]["uom_kind"]
          name: string
        }
        Update: {
          code?: string
          kind?: Database["public"]["Enums"]["uom_kind"]
          name?: string
        }
        Relationships: []
      }
      zone: {
        Row: {
          abc_class: Database["public"]["Enums"]["abc_class"] | null
          code: string
          id: string
          kind: Database["public"]["Enums"]["zone_type"]
          name: string
          site_id: string
        }
        Insert: {
          abc_class?: Database["public"]["Enums"]["abc_class"] | null
          code: string
          id?: string
          kind: Database["public"]["Enums"]["zone_type"]
          name: string
          site_id: string
        }
        Update: {
          abc_class?: Database["public"]["Enums"]["abc_class"] | null
          code?: string
          id?: string
          kind?: Database["public"]["Enums"]["zone_type"]
          name?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_spec: {
        Row: {
          aisle_width_mm: number | null
          bays: number
          depth_columns: number
          is_provisional: boolean
          lane_depth: number
          level_height_mm: number | null
          levels: number
          max_pallets_stacked: number | null
          max_weight_kg: number | null
          source: string | null
          zone_id: string
        }
        Insert: {
          aisle_width_mm?: number | null
          bays: number
          depth_columns: number
          is_provisional?: boolean
          lane_depth?: number
          level_height_mm?: number | null
          levels?: number
          max_pallets_stacked?: number | null
          max_weight_kg?: number | null
          source?: string | null
          zone_id: string
        }
        Update: {
          aisle_width_mm?: number | null
          bays?: number
          depth_columns?: number
          is_provisional?: boolean
          lane_depth?: number
          level_height_mm?: number | null
          levels?: number
          max_pallets_stacked?: number | null
          max_weight_kg?: number | null
          source?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_spec_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: true
            referencedRelation: "zone"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      barcode_conflict: {
        Row: {
          code: string | null
          productos: number | null
          skus: string[] | null
        }
        Relationships: []
      }
      product_readiness: {
        Row: {
          codigo_sin_conflicto: boolean | null
          id: string | null
          name: string | null
          sku: string | null
          tiene_clase: boolean | null
          tiene_codigo: boolean | null
          tiene_corrugado: boolean | null
          tiene_estiba: boolean | null
        }
        Insert: {
          codigo_sin_conflicto?: never
          id?: string | null
          name?: string | null
          sku?: string | null
          tiene_clase?: never
          tiene_codigo?: never
          tiene_corrugado?: never
          tiene_estiba?: never
        }
        Update: {
          codigo_sin_conflicto?: never
          id?: string | null
          name?: string | null
          sku?: string | null
          tiene_clase?: never
          tiene_codigo?: never
          tiene_corrugado?: never
          tiene_estiba?: never
        }
        Relationships: []
      }
    }
    Functions: {
      apply_stock_delta: {
        Args: {
          p_delta: number
          p_expiry: string
          p_location_id: string
          p_lot: string
          p_lpn_id: string
          p_product_id: string
        }
        Returns: undefined
      }
      current_role_name: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      generate_zone_locations: {
        Args: { p_zone_code: string }
        Returns: number
      }
      has_role: {
        Args: { roles: Database["public"]["Enums"]["user_role"][] }
        Returns: boolean
      }
      post_movement: {
        Args: {
          p_device_id?: string
          p_expiry?: string
          p_from_location_id?: string
          p_idempotency_key?: string
          p_lot?: string
          p_lpn_id?: string
          p_note?: string
          p_packaging_level_id?: string
          p_product_id: string
          p_qty: number
          p_reason_code?: string
          p_task_id?: string
          p_to_location_id?: string
          p_type: Database["public"]["Enums"]["movement_type"]
        }
        Returns: number
      }
      verify_ledger: {
        Args: never
        Returns: {
          first_broken_id: number
        }[]
      }
    }
    Enums: {
      abc_class: "A" | "B" | "C"
      barcode_symbology: "EAN13" | "EAN8" | "GTIN14" | "CODE128" | "INTERNO"
      contamination_class: "ALIMENTO" | "QUIMICO" | "AROMATICO" | "NO_ALIMENTO"
      dock_direction: "inbound" | "outbound" | "both"
      location_status: "available" | "occupied" | "blocked" | "damaged"
      location_type:
        | "floor_stack"
        | "rack_single"
        | "rack_double_deep"
        | "staging"
        | "dock"
        | "quarantine"
      lpn_status: "active" | "consumed" | "cancelled"
      movement_type:
        | "RECEIPT"
        | "PUTAWAY"
        | "PICK"
        | "MOVE"
        | "ADJUST"
        | "COUNT"
        | "SHIP"
        | "RETURN"
      packaging_code: "UNIT" | "INNER" | "CASE" | "LAYER" | "PALLET"
      product_status: "active" | "blocked" | "discontinued"
      reason_category:
        | "VENTA"
        | "MERMA"
        | "SINIESTRO"
        | "CALIDAD"
        | "AJUSTE"
        | "TRASLADO"
        | "DEVOLUCION"
      uom_kind: "count" | "weight" | "volume" | "length"
      user_role:
        | "operador_recibo"
        | "operador_picking"
        | "montacargista"
        | "supervisor"
        | "inventarios"
        | "admin"
        | "solo_lectura"
      weight_category: "LIGERO" | "MEDIO" | "PESADO"
      zone_type:
        | "rack"
        | "floor"
        | "staging"
        | "dock"
        | "quarantine"
        | "returns"
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
    Enums: {
      abc_class: ["A", "B", "C"],
      barcode_symbology: ["EAN13", "EAN8", "GTIN14", "CODE128", "INTERNO"],
      contamination_class: ["ALIMENTO", "QUIMICO", "AROMATICO", "NO_ALIMENTO"],
      dock_direction: ["inbound", "outbound", "both"],
      location_status: ["available", "occupied", "blocked", "damaged"],
      location_type: [
        "floor_stack",
        "rack_single",
        "rack_double_deep",
        "staging",
        "dock",
        "quarantine",
      ],
      lpn_status: ["active", "consumed", "cancelled"],
      movement_type: [
        "RECEIPT",
        "PUTAWAY",
        "PICK",
        "MOVE",
        "ADJUST",
        "COUNT",
        "SHIP",
        "RETURN",
      ],
      packaging_code: ["UNIT", "INNER", "CASE", "LAYER", "PALLET"],
      product_status: ["active", "blocked", "discontinued"],
      reason_category: [
        "VENTA",
        "MERMA",
        "SINIESTRO",
        "CALIDAD",
        "AJUSTE",
        "TRASLADO",
        "DEVOLUCION",
      ],
      uom_kind: ["count", "weight", "volume", "length"],
      user_role: [
        "operador_recibo",
        "operador_picking",
        "montacargista",
        "supervisor",
        "inventarios",
        "admin",
        "solo_lectura",
      ],
      weight_category: ["LIGERO", "MEDIO", "PESADO"],
      zone_type: ["rack", "floor", "staging", "dock", "quarantine", "returns"],
    },
  },
} as const
