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
  public: {
    Tables: {
      allocation: {
        Row: {
          created_at: string
          id: string
          order_line_id: string
          qty_base: number
          stock_id: string
          task_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_line_id: string
          qty_base: number
          stock_id: string
          task_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_line_id?: string
          qty_base?: number
          stock_id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allocation_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_stock_id_fkey"
            columns: ["stock_id"]
            isOneToOne: false
            referencedRelation: "stock_available"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "allocation_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_timing"
            referencedColumns: ["id"]
          },
        ]
      }
      area: {
        Row: {
          barcode: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          replenish_pct: number
          site_id: string
          type_code: string
        }
        Insert: {
          barcode?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          replenish_pct?: number
          site_id: string
          type_code: string
        }
        Update: {
          barcode?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          replenish_pct?: number
          site_id?: string
          type_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "site"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_type_code_fkey"
            columns: ["type_code"]
            isOneToOne: false
            referencedRelation: "area_type"
            referencedColumns: ["code"]
          },
        ]
      }
      area_type: {
        Row: {
          code: string
          is_active: boolean
          is_terminal: boolean
          is_virtual: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          is_active?: boolean
          is_terminal?: boolean
          is_virtual?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          is_active?: boolean
          is_terminal?: boolean
          is_virtual?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
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
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_primary?: boolean
          packaging_level_id: string
          symbology: Database["public"]["Enums"]["barcode_symbology"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          packaging_level_id?: string
          symbology?: Database["public"]["Enums"]["barcode_symbology"]
          verified_at?: string | null
          verified_by?: string | null
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
      correo_autorizado: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          nota: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          nota?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          nota?: string | null
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
      equipment: {
        Row: {
          code: string
          id: string
          is_active: boolean
          type_code: string
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          type_code: string
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          type_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_type_code_fkey"
            columns: ["type_code"]
            isOneToOne: false
            referencedRelation: "equipment_type"
            referencedColumns: ["code"]
          },
        ]
      }
      equipment_type: {
        Row: {
          code: string
          is_active: boolean
          max_level: number
          name: string
        }
        Insert: {
          code: string
          is_active?: boolean
          max_level: number
          name: string
        }
        Update: {
          code?: string
          is_active?: boolean
          max_level?: number
          name?: string
        }
        Relationships: []
      }
      inbound_doc: {
        Row: {
          created_at: string
          entrega: string | null
          goods_issue: string | null
          id: string
          mix: string | null
          nota: string | null
          origin_plant: string | null
          pedido: string
          planned_at: string | null
          sin_aviso: boolean
          status: string
          tabulado: string | null
          transporte: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entrega?: string | null
          goods_issue?: string | null
          id?: string
          mix?: string | null
          nota?: string | null
          origin_plant?: string | null
          pedido: string
          planned_at?: string | null
          sin_aviso?: boolean
          status?: string
          tabulado?: string | null
          transporte?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entrega?: string | null
          goods_issue?: string | null
          id?: string
          mix?: string | null
          nota?: string | null
          origin_plant?: string | null
          pedido?: string
          planned_at?: string | null
          sin_aviso?: boolean
          status?: string
          tabulado?: string | null
          transporte?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inbound_line: {
        Row: {
          doc_id: string
          expiry_date: string | null
          id: string
          line_no: number
          lot: string | null
          product_id: string
          qty_cases: number
        }
        Insert: {
          doc_id: string
          expiry_date?: string | null
          id?: string
          line_no: number
          lot?: string | null
          product_id: string
          qty_cases: number
        }
        Update: {
          doc_id?: string
          expiry_date?: string | null
          id?: string
          line_no?: number
          lot?: string | null
          product_id?: string
          qty_cases?: number
        }
        Relationships: [
          {
            foreignKeyName: "inbound_line_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "inbound_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_line_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "inbound_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_line_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "ingreso_abierto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inbound_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inbound_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_pallet: {
        Row: {
          doc_id: string
          expiry_date: string | null
          id: string
          lot: string | null
          pallet_code: string
          product_id: string
          qty_cases: number
          received_at: string | null
          received_lpn_id: string | null
        }
        Insert: {
          doc_id: string
          expiry_date?: string | null
          id?: string
          lot?: string | null
          pallet_code: string
          product_id: string
          qty_cases: number
          received_at?: string | null
          received_lpn_id?: string | null
        }
        Update: {
          doc_id?: string
          expiry_date?: string | null
          id?: string
          lot?: string | null
          pallet_code?: string
          product_id?: string
          qty_cases?: number
          received_at?: string | null
          received_lpn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_pallet_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "inbound_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "inbound_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "ingreso_abierto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inbound_pallet_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inbound_pallet_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_received_lpn_id_fkey"
            columns: ["received_lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
          },
          {
            foreignKeyName: "inbound_pallet_received_lpn_id_fkey"
            columns: ["received_lpn_id"]
            isOneToOne: false
            referencedRelation: "lpn"
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
          reserved_by_task_id: string | null
          reserved_until: string | null
          retired_at: string | null
          status: Database["public"]["Enums"]["location_status"]
          updated_at: string
          usage_code: string
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
          reserved_by_task_id?: string | null
          reserved_until?: string | null
          retired_at?: string | null
          status?: Database["public"]["Enums"]["location_status"]
          updated_at?: string
          usage_code?: string
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
          reserved_by_task_id?: string | null
          reserved_until?: string | null
          retired_at?: string | null
          status?: Database["public"]["Enums"]["location_status"]
          updated_at?: string
          usage_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lane"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_reserved_by_task_id_fkey"
            columns: ["reserved_by_task_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "location_reserved_by_task_id_fkey"
            columns: ["reserved_by_task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_reserved_by_task_id_fkey"
            columns: ["reserved_by_task_id"]
            isOneToOne: false
            referencedRelation: "task_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_reserved_by_task_id_fkey"
            columns: ["reserved_by_task_id"]
            isOneToOne: false
            referencedRelation: "task_timing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_usage_code_fkey"
            columns: ["usage_code"]
            isOneToOne: false
            referencedRelation: "location_usage"
            referencedColumns: ["code"]
          },
        ]
      }
      location_area: {
        Row: {
          area_id: string
          location_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          area_id: string
          location_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          area_id?: string
          location_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_area_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "area"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_area_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "location_area_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "location_area_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_area_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_area_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
        ]
      }
      location_tag: {
        Row: {
          location_id: string
          tag_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          location_id: string
          tag_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          location_id?: string
          tag_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_tag_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "location_tag_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "location_tag_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_tag_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_tag_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_tag_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tag"
            referencedColumns: ["id"]
          },
        ]
      }
      location_usage: {
        Row: {
          code: string
          holds_product: boolean
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          holds_product?: boolean
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          holds_product?: boolean
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      lpn: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          level: Database["public"]["Enums"]["packaging_code"]
          parent_id: string | null
          source: string
          status: Database["public"]["Enums"]["lpn_status"]
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          level?: Database["public"]["Enums"]["packaging_code"]
          parent_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lpn_status"]
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          level?: Database["public"]["Enums"]["packaging_code"]
          parent_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lpn_status"]
        }
        Relationships: [
          {
            foreignKeyName: "lpn_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
          },
          {
            foreignKeyName: "lpn_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "lpn"
            referencedColumns: ["id"]
          },
        ]
      }
      order_crossdock: {
        Row: {
          created_at: string
          created_by: string | null
          expiry_date: string | null
          from_location_id: string
          id: string
          lot: string | null
          lpn_id: string | null
          order_line_id: string
          product_id: string
          qty_base: number
          to_location_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          from_location_id: string
          id?: string
          lot?: string | null
          lpn_id?: string | null
          order_line_id: string
          product_id: string
          qty_base: number
          to_location_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          from_location_id?: string
          id?: string
          lot?: string | null
          lpn_id?: string | null
          order_line_id?: string
          product_id?: string
          qty_base?: number
          to_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_crossdock_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "order_crossdock_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "order_crossdock_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
          },
          {
            foreignKeyName: "order_crossdock_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "lpn"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_crossdock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_crossdock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "order_crossdock_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "order_crossdock_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossdock_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
        ]
      }
      order_line: {
        Row: {
          checked_at: string | null
          checked_by: string | null
          id: string
          line_no: number
          order_id: string
          packaging_level_id: string | null
          product_id: string
          qty_base: number
        }
        Insert: {
          checked_at?: string | null
          checked_by?: string | null
          id?: string
          line_no: number
          order_id: string
          packaging_level_id?: string | null
          product_id: string
          qty_base: number
        }
        Update: {
          checked_at?: string | null
          checked_by?: string | null
          id?: string
          line_no?: number
          order_id?: string
          packaging_level_id?: string | null
          product_id?: string
          qty_base?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_line_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "disponibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "despacho_progreso"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_packaging_level_id_fkey"
            columns: ["packaging_level_id"]
            isOneToOne: false
            referencedRelation: "packaging_level"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_form: {
        Row: {
          code: string
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          name?: string
          sort_order?: number
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
          is_sellable: boolean
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
          is_sellable?: boolean
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
          is_sellable?: boolean
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
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "packaging_level_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
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
          cases_per_layer: number | null
          cases_per_pallet: number
          id: string
          is_default: boolean
          layers: number | null
          max_stack: number | null
          pallet_type_code: string
          product_id: string
          total_height_mm: number | null
          total_weight_kg: number | null
        }
        Insert: {
          allows_stacking?: boolean
          cases_per_layer?: number | null
          cases_per_pallet: number
          id?: string
          is_default?: boolean
          layers?: number | null
          max_stack?: number | null
          pallet_type_code: string
          product_id: string
          total_height_mm?: number | null
          total_weight_kg?: number | null
        }
        Update: {
          allows_stacking?: boolean
          cases_per_layer?: number | null
          cases_per_pallet?: number
          id?: string
          is_default?: boolean
          layers?: number | null
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
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "pallet_config_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
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
          base_code: string | null
          base_uom: string
          brand: string | null
          category_id: string | null
          contamination_class:
            | Database["public"]["Enums"]["contamination_class"]
            | null
          created_at: string
          external_barcode_hint: string | null
          external_source: string | null
          humidity_sensitive: boolean
          id: string
          is_fragile: boolean
          min_days_on_dispatch: number | null
          name: string
          packaging_form_code: string | null
          requires_fefo: boolean
          sector: string | null
          shelf_life_days: number | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          temp_max_c: number | null
          temp_min_c: number | null
          type_code: string
          units_label: string | null
          updated_at: string
          variant: string | null
          weight_category: Database["public"]["Enums"]["weight_category"] | null
        }
        Insert: {
          base_code?: string | null
          base_uom: string
          brand?: string | null
          category_id?: string | null
          contamination_class?:
            | Database["public"]["Enums"]["contamination_class"]
            | null
          created_at?: string
          external_barcode_hint?: string | null
          external_source?: string | null
          humidity_sensitive?: boolean
          id?: string
          is_fragile?: boolean
          min_days_on_dispatch?: number | null
          name: string
          packaging_form_code?: string | null
          requires_fefo?: boolean
          sector?: string | null
          shelf_life_days?: number | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          temp_max_c?: number | null
          temp_min_c?: number | null
          type_code?: string
          units_label?: string | null
          updated_at?: string
          variant?: string | null
          weight_category?:
            | Database["public"]["Enums"]["weight_category"]
            | null
        }
        Update: {
          base_code?: string | null
          base_uom?: string
          brand?: string | null
          category_id?: string | null
          contamination_class?:
            | Database["public"]["Enums"]["contamination_class"]
            | null
          created_at?: string
          external_barcode_hint?: string | null
          external_source?: string | null
          humidity_sensitive?: boolean
          id?: string
          is_fragile?: boolean
          min_days_on_dispatch?: number | null
          name?: string
          packaging_form_code?: string | null
          requires_fefo?: boolean
          sector?: string | null
          shelf_life_days?: number | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          temp_max_c?: number | null
          temp_min_c?: number | null
          type_code?: string
          units_label?: string | null
          updated_at?: string
          variant?: string | null
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
          {
            foreignKeyName: "product_packaging_form_code_fkey"
            columns: ["packaging_form_code"]
            isOneToOne: false
            referencedRelation: "packaging_form"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_type_code_fkey"
            columns: ["type_code"]
            isOneToOne: false
            referencedRelation: "product_type"
            referencedColumns: ["code"]
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
      product_label_profile: {
        Row: {
          assessed_at: string | null
          has_expiry: boolean
          has_gtin: boolean
          has_lot: boolean
          has_unique_case_code: boolean
          product_id: string
          source: string | null
          updated_at: string
        }
        Insert: {
          assessed_at?: string | null
          has_expiry?: boolean
          has_gtin?: boolean
          has_lot?: boolean
          has_unique_case_code?: boolean
          product_id: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          assessed_at?: string | null
          has_expiry?: boolean
          has_gtin?: boolean
          has_lot?: boolean
          has_unique_case_code?: boolean
          product_id?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_label_profile_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_label_profile_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_label_profile_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_label_profile_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
        ]
      }
      product_type: {
        Row: {
          code: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      profile: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          roles_extra: Database["public"]["Enums"]["user_role"][]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_code?: string | null
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          roles_extra?: Database["public"]["Enums"]["user_role"][]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_code?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          roles_extra?: Database["public"]["Enums"]["user_role"][]
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
      returnable_count: {
        Row: {
          location_id: string
          qty: number
          updated_at: string
        }
        Insert: {
          location_id: string
          qty?: number
          updated_at?: string
        }
        Update: {
          location_id?: string
          qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "returnable_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "returnable_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "returnable_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returnable_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returnable_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
        ]
      }
      returnable_movement: {
        Row: {
          actor_id: string | null
          delta: number
          id: number
          location_id: string
          note: string | null
          occurred_at: string
          qty_after: number
        }
        Insert: {
          actor_id?: string | null
          delta: number
          id?: never
          location_id: string
          note?: string | null
          occurred_at?: string
          qty_after: number
        }
        Update: {
          actor_id?: string | null
          delta?: number
          id?: never
          location_id?: string
          note?: string | null
          occurred_at?: string
          qty_after?: number
        }
        Relationships: [
          {
            foreignKeyName: "returnable_movement_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "returnable_movement_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "returnable_movement_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returnable_movement_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returnable_movement_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          customer: string | null
          dock_door_id: string | null
          entregas: string[] | null
          id: string
          released_at: string | null
          ship_note: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          transporte: string | null
          wave_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          customer?: string | null
          dock_door_id?: string | null
          entregas?: string[] | null
          id?: string
          released_at?: string | null
          ship_note?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          transporte?: string | null
          wave_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          customer?: string | null
          dock_door_id?: string | null
          entregas?: string[] | null
          id?: string
          released_at?: string | null
          ship_note?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          transporte?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_dock_door_id_fkey"
            columns: ["dock_door_id"]
            isOneToOne: false
            referencedRelation: "dock_door"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "wave"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_assignment: {
        Row: {
          dock_door_id: string | null
          ended_at: string | null
          equipment_id: string | null
          equipment_type_code: string | null
          flow: string
          id: string
          pause_note: string | null
          paused_at: string | null
          profile_id: string
          started_at: string
          working_role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          dock_door_id?: string | null
          ended_at?: string | null
          equipment_id?: string | null
          equipment_type_code?: string | null
          flow?: string
          id?: string
          pause_note?: string | null
          paused_at?: string | null
          profile_id: string
          started_at?: string
          working_role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          dock_door_id?: string | null
          ended_at?: string | null
          equipment_id?: string | null
          equipment_type_code?: string | null
          flow?: string
          id?: string
          pause_note?: string | null
          paused_at?: string | null
          profile_id?: string
          started_at?: string
          working_role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignment_dock_door_id_fkey"
            columns: ["dock_door_id"]
            isOneToOne: false
            referencedRelation: "dock_door"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignment_equipment_type_code_fkey"
            columns: ["equipment_type_code"]
            isOneToOne: false
            referencedRelation: "equipment_type"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "shift_assignment_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "disponibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignment_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
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
          qty_allocated: number
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
          qty_allocated?: number
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
          qty_allocated?: number
          qty_base?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
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
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
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
      stock_count: {
        Row: {
          counted_at: string
          counted_by: string | null
          expiry_date: string | null
          id: string
          location_id: string
          lot: string | null
          lpn_id: string | null
          movement_id: number | null
          note: string | null
          product_id: string
          qty_expected: number
          qty_found: number
          task_id: string | null
        }
        Insert: {
          counted_at?: string
          counted_by?: string | null
          expiry_date?: string | null
          id?: string
          location_id: string
          lot?: string | null
          lpn_id?: string | null
          movement_id?: number | null
          note?: string | null
          product_id: string
          qty_expected: number
          qty_found: number
          task_id?: string | null
        }
        Update: {
          counted_at?: string
          counted_by?: string | null
          expiry_date?: string | null
          id?: string
          location_id?: string
          lot?: string | null
          lpn_id?: string | null
          movement_id?: number | null
          note?: string | null
          product_id?: string
          qty_expected?: number
          qty_found?: number
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
          },
          {
            foreignKeyName: "stock_count_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "lpn"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_count_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_count_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_timing"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movement: {
        Row: {
          actor_id: string | null
          device_id: string | null
          equipment_id: string | null
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
          equipment_id?: string | null
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
          equipment_id?: string | null
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
            foreignKeyName: "stock_movement_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_movement_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_movement_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
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
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movement_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
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
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_movement_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_movement_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
        ]
      }
      tag: {
        Row: {
          code: string
          id: string
          is_active: boolean
          kind: string
          name: string
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
        }
        Relationships: []
      }
      task: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          closed_reason: string | null
          completed_at: string | null
          created_at: string
          expiry_date: string | null
          flow: string | null
          from_location_id: string | null
          id: string
          lot: string | null
          lpn_id: string | null
          min_level: number | null
          packaging_level_id: string | null
          priority: number
          product_id: string | null
          qty_base: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id: string | null
          zone_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          closed_reason?: string | null
          completed_at?: string | null
          created_at?: string
          expiry_date?: string | null
          flow?: string | null
          from_location_id?: string | null
          id?: string
          lot?: string | null
          lpn_id?: string | null
          min_level?: number | null
          packaging_level_id?: string | null
          priority?: number
          product_id?: string | null
          qty_base?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          to_location_id?: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id?: string | null
          zone_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          closed_reason?: string | null
          completed_at?: string | null
          created_at?: string
          expiry_date?: string | null
          flow?: string | null
          from_location_id?: string | null
          id?: string
          lot?: string | null
          lpn_id?: string | null
          min_level?: number | null
          packaging_level_id?: string | null
          priority?: number
          product_id?: string | null
          qty_base?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          to_location_id?: string | null
          type?: Database["public"]["Enums"]["task_type"]
          wave_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
          },
          {
            foreignKeyName: "task_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "lpn"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_packaging_level_id_fkey"
            columns: ["packaging_level_id"]
            isOneToOne: false
            referencedRelation: "packaging_level"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "wave"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zone"
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
      wave: {
        Row: {
          code: string
          created_at: string
          cutoff_at: string | null
          dock_door_id: string | null
          id: string
        }
        Insert: {
          code: string
          created_at?: string
          cutoff_at?: string | null
          dock_door_id?: string | null
          id?: string
        }
        Update: {
          code?: string
          created_at?: string
          cutoff_at?: string | null
          dock_door_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wave_dock_door_id_fkey"
            columns: ["dock_door_id"]
            isOneToOne: false
            referencedRelation: "dock_door"
            referencedColumns: ["id"]
          },
        ]
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
      apilado_en_piso: {
        Row: {
          cases_per_pallet: number | null
          name: string | null
          niveles: number | null
          sku: string | null
        }
        Relationships: []
      }
      area_occupancy: {
        Row: {
          code: string | null
          is_virtual: boolean | null
          name: string | null
          ocupadas: number | null
          total: number | null
        }
        Relationships: []
      }
      barcode_conflict: {
        Row: {
          bases: number | null
          code: string | null
          productos: number | null
        }
        Relationships: []
      }
      carga_por_anden: {
        Row: {
          anden: string | null
          asignadas: number | null
          direction: Database["public"]["Enums"]["dock_direction"] | null
          en_curso: number | null
          libres: number | null
          personas: number | null
        }
        Relationships: []
      }
      conteos_pendientes: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          location_id: string | null
          nivel: number | null
          pick_sequence: number | null
          posicion: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_id: string | null
          zona: string | null
        }
        Relationships: []
      }
      despacho_progreso: {
        Row: {
          anden: string | null
          code: string | null
          crossdock: number | null
          customer: string | null
          entregas: string[] | null
          id: string | null
          lineas: number | null
          pedido: number | null
          pendientes: number | null
          status: Database["public"]["Enums"]["order_status"] | null
          surtido: number | null
          transporte: string | null
        }
        Relationships: []
      }
      disponibles: {
        Row: {
          alcance: number | null
          anden: string | null
          anden_lado: Database["public"]["Enums"]["dock_direction"] | null
          disponible: boolean | null
          equipo: string | null
          full_name: string | null
          id: string | null
          pause_note: string | null
          rol_trabajo: Database["public"]["Enums"]["user_role"] | null
          role: Database["public"]["Enums"]["user_role"] | null
          roles_extra: Database["public"]["Enums"]["user_role"][] | null
          started_at: string | null
        }
        Relationships: []
      }
      estiba_vs_capacidad: {
        Row: {
          estiba_mas_pesada_kg: number | null
          kind: Database["public"]["Enums"]["zone_type"] | null
          limite_kg: number | null
          no_caben: number | null
          productos: number | null
          zona: string | null
        }
        Relationships: []
      }
      inbound_detail: {
        Row: {
          base_code: string | null
          doc_id: string | null
          expiry_date: string | null
          id: string | null
          lot: string | null
          name: string | null
          pallet_code: string | null
          pedido: string | null
          product_id: string | null
          qty_cases: number | null
          received_at: string | null
          received_lpn_id: string | null
          sku: string | null
          tipo_caja: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_pallet_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "inbound_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "inbound_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "ingreso_abierto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_pallet_received_lpn_id_fkey"
            columns: ["received_lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
          },
          {
            foreignKeyName: "inbound_pallet_received_lpn_id_fkey"
            columns: ["received_lpn_id"]
            isOneToOne: false
            referencedRelation: "lpn"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_progress: {
        Row: {
          cajas: number | null
          id: string | null
          materiales: number | null
          nota: string | null
          origin_plant: string | null
          pallets: number | null
          pedido: string | null
          planned_at: string | null
          recibidos: number | null
          sin_aviso: boolean | null
          status: string | null
        }
        Relationships: []
      }
      inexactitud: {
        Row: {
          conteos: number | null
          descuadres: number | null
          pct_conteos_con_descuadre: number | null
          pct_unidades: number | null
          persona: string | null
          profile_id: string | null
          ultimo: string | null
          unidades_de_diferencia: number | null
          unidades_esperadas: number | null
        }
        Relationships: []
      }
      ingreso_abierto: {
        Row: {
          cajas: number | null
          created_at: string | null
          id: string | null
          materiales: number | null
          nota: string | null
          origin_plant: string | null
          pallets: number | null
          pedido: string | null
          status: string | null
        }
        Relationships: []
      }
      inventario: {
        Row: {
          area_code: string | null
          area_name: string | null
          base_code: string | null
          cajas: number | null
          disponible: number | null
          expiry_date: string | null
          id: string | null
          level: number | null
          location_code: string | null
          location_id: string | null
          lot: string | null
          lpn_code: string | null
          lpn_id: string | null
          name: string | null
          por_caja: number | null
          product_id: string | null
          qty_allocated: number | null
          qty_base: number | null
          sku: string | null
          sueltas: number | null
          zone_code: string | null
          zone_kind: Database["public"]["Enums"]["zone_type"] | null
        }
        Relationships: []
      }
      mi_trabajo: {
        Row: {
          alcance: number | null
          anden: string | null
          equipo: string | null
          flow: string | null
          pause_note: string | null
          paused_at: string | null
          profile_id: string | null
          rol_trabajo: Database["public"]["Enums"]["user_role"] | null
          started_at: string | null
          tipo_equipo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignment_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "disponibles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignment_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      picking_bajo: {
        Row: {
          disponible: number | null
          expiry_date: string | null
          hay_en_origen: number | null
          lot: string | null
          lote_origen: string | null
          pct: number | null
          por_caja: number | null
          posicion: string | null
          producto: string | null
          replenish_pct: number | null
          sacar_de: string | null
          sku: string | null
          tope: number | null
          vence_origen: string | null
        }
        Relationships: []
      }
      posicion_detalle: {
        Row: {
          apartada: boolean | null
          area_code: string | null
          area_name: string | null
          code: string | null
          holds_product: boolean | null
          id: string | null
          lane_code: string | null
          level: number | null
          ocupada: boolean | null
          usage_code: string | null
          usage_name: string | null
          zone_code: string | null
          zone_kind: Database["public"]["Enums"]["zone_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "location_usage_code_fkey"
            columns: ["usage_code"]
            isOneToOne: false
            referencedRelation: "location_usage"
            referencedColumns: ["code"]
          },
        ]
      }
      posicion_estado: {
        Row: {
          code: string | null
          estado: string | null
        }
        Relationships: []
      }
      product_readiness: {
        Row: {
          base_code: string | null
          cajas_por_pallet: number | null
          codigo_compartido: boolean | null
          codigo_sin_conflicto: boolean | null
          dun: string | null
          id: string | null
          name: string | null
          por_caja: number | null
          sector: string | null
          sku: string | null
          status: Database["public"]["Enums"]["product_status"] | null
          tiene_clase: boolean | null
          tiene_codigo: boolean | null
          tiene_corrugado: boolean | null
          tiene_estiba: boolean | null
          tipo_caja: string | null
          units_label: string | null
          variant: string | null
        }
        Insert: {
          base_code?: string | null
          cajas_por_pallet?: never
          codigo_compartido?: never
          codigo_sin_conflicto?: never
          dun?: never
          id?: string | null
          name?: string | null
          por_caja?: never
          sector?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"] | null
          tiene_clase?: never
          tiene_codigo?: never
          tiene_corrugado?: never
          tiene_estiba?: never
          tipo_caja?: never
          units_label?: string | null
          variant?: string | null
        }
        Update: {
          base_code?: string | null
          cajas_por_pallet?: never
          codigo_compartido?: never
          codigo_sin_conflicto?: never
          dun?: never
          id?: string | null
          name?: string | null
          por_caja?: never
          sector?: string | null
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"] | null
          tiene_clase?: never
          tiene_codigo?: never
          tiene_corrugado?: never
          tiene_estiba?: never
          tipo_caja?: never
          units_label?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      rack_elevacion: {
        Row: {
          apartada: boolean | null
          bahia: number | null
          code: string | null
          expiry_date: string | null
          fondo: number | null
          lane_code: string | null
          lot: string | null
          lpn_code: string | null
          name: string | null
          nivel: number | null
          product_id: string | null
          qty_base: number | null
          sku: string | null
          status: Database["public"]["Enums"]["location_status"] | null
          usage_code: string | null
          zone_code: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_usage_code_fkey"
            columns: ["usage_code"]
            isOneToOne: false
            referencedRelation: "location_usage"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
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
      recuentos: {
        Row: {
          counted_at: string | null
          diferencia: number | null
          expiry_date: string | null
          id: string | null
          lot: string | null
          note: string | null
          pallet: string | null
          persona: string | null
          por_caja: number | null
          posicion: string | null
          producto: string | null
          qty_expected: number | null
          qty_found: number | null
          sku: string | null
          task_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_timing"
            referencedColumns: ["id"]
          },
        ]
      }
      retornables: {
        Row: {
          cantidad: number | null
          code: string | null
          id: string | null
          updated_at: string | null
          usage_code: string | null
          uso: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_usage_code_fkey"
            columns: ["usage_code"]
            isOneToOne: false
            referencedRelation: "location_usage"
            referencedColumns: ["code"]
          },
        ]
      }
      stock_available: {
        Row: {
          expiry_date: string | null
          id: string | null
          location_id: string | null
          lot: string | null
          lpn_id: string | null
          product_id: string | null
          qty_allocated: number | null
          qty_available: number | null
          qty_base: number | null
          updated_at: string | null
        }
        Insert: {
          expiry_date?: string | null
          id?: string | null
          location_id?: string | null
          lot?: string | null
          lpn_id?: string | null
          product_id?: string | null
          qty_allocated?: number | null
          qty_available?: never
          qty_base?: number | null
          updated_at?: string | null
        }
        Update: {
          expiry_date?: string | null
          id?: string | null
          location_id?: string | null
          lot?: string | null
          lpn_id?: string | null
          product_id?: string | null
          qty_allocated?: number | null
          qty_available?: never
          qty_base?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lpn_id_fkey"
            columns: ["lpn_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["lpn_id"]
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
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
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
      task_queue: {
        Row: {
          al_alcance: boolean | null
          created_at: string | null
          de_mi_flujo: boolean | null
          flow: string | null
          from_location_id: string | null
          id: string | null
          min_level: number | null
          priority: number | null
          product_id: string | null
          qty_base: number | null
          status: Database["public"]["Enums"]["task_status"] | null
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"] | null
        }
        Insert: {
          al_alcance?: never
          created_at?: string | null
          de_mi_flujo?: never
          flow?: string | null
          from_location_id?: string | null
          id?: string | null
          min_level?: number | null
          priority?: number | null
          product_id?: string | null
          qty_base?: number | null
          status?: Database["public"]["Enums"]["task_status"] | null
          to_location_id?: string | null
          type?: Database["public"]["Enums"]["task_type"] | null
        }
        Update: {
          al_alcance?: never
          created_at?: string | null
          de_mi_flujo?: never
          flow?: string | null
          from_location_id?: string | null
          id?: string | null
          min_level?: number | null
          priority?: number | null
          product_id?: string | null
          qty_base?: number | null
          status?: Database["public"]["Enums"]["task_status"] | null
          to_location_id?: string | null
          type?: Database["public"]["Enums"]["task_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inbound_detail"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_readiness"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "conteos_pendientes"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventario"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "posicion_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "retornables"
            referencedColumns: ["id"]
          },
        ]
      }
      task_timing: {
        Row: {
          assigned_to: string | null
          ciclo_min: number | null
          completed_at: string | null
          created_at: string | null
          ejecucion_min: number | null
          espera_min: number | null
          id: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          type: Database["public"]["Enums"]["task_type"] | null
          viaje_min: number | null
          zone_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          ciclo_min?: never
          completed_at?: string | null
          created_at?: string | null
          ejecucion_min?: never
          espera_min?: never
          id?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          type?: Database["public"]["Enums"]["task_type"] | null
          viaje_min?: never
          zone_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          ciclo_min?: never
          completed_at?: string | null
          created_at?: string | null
          ejecucion_min?: never
          espera_min?: never
          id?: string | null
          status?: Database["public"]["Enums"]["task_status"] | null
          type?: Database["public"]["Enums"]["task_type"] | null
          viaje_min?: never
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zone"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_occupancy: {
        Row: {
          code: string | null
          kind: Database["public"]["Enums"]["zone_type"] | null
          ocupadas: number | null
          total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      abrir_ingreso_sin_aviso: {
        Args: { p_nota?: string; p_origen?: string }
        Returns: {
          created_at: string
          entrega: string | null
          goods_issue: string | null
          id: string
          mix: string | null
          nota: string | null
          origin_plant: string | null
          pedido: string
          planned_at: string | null
          sin_aviso: boolean
          status: string
          tabulado: string | null
          transporte: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inbound_doc"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ajustar_aviso_reabastecimiento: {
        Args: { p_area_code: string; p_pct: number }
        Returns: {
          barcode: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          replenish_pct: number
          site_id: string
          type_code: string
        }
        SetofOptions: {
          from: "*"
          to: "area"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      alcance_de: { Args: { p_profile_id: string }; Returns: number }
      apartar_linea: { Args: { p_order_line_id: string }; Returns: number }
      apartar_lo_que_falta: { Args: { p_order_id?: string }; Returns: number }
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
      aprobar_persona: {
        Args: { p_id: string; p_role: Database["public"]["Enums"]["user_role"] }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          roles_extra: Database["public"]["Enums"]["user_role"][]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      area_de: {
        Args: { p_location_id: string }
        Returns: {
          barcode: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          replenish_pct: number
          site_id: string
          type_code: string
        }
        SetofOptions: {
          from: "*"
          to: "area"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      asignar_anden: {
        Args: { p_anden?: string; p_profile_id: string }
        Returns: {
          anden: string
          en_curso: string
          liberadas: number
        }[]
      }
      assign_barcode: {
        Args: {
          p_code: string
          p_packaging_code?: Database["public"]["Enums"]["packaging_code"]
          p_product_id: string
          p_symbology?: Database["public"]["Enums"]["barcode_symbology"]
        }
        Returns: {
          code: string
          created_at: string
          id: string
          is_primary: boolean
          packaging_level_id: string
          symbology: Database["public"]["Enums"]["barcode_symbology"]
          verified_at: string | null
          verified_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "barcode"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      autorizar_correos: {
        Args: { p_emails: string[]; p_nota?: string }
        Returns: number
      }
      buscar_despacho: { Args: { p_codigo: string }; Returns: string }
      buscar_ingreso: {
        Args: { p_pedido: string }
        Returns: {
          cajas: number | null
          id: string | null
          materiales: number | null
          nota: string | null
          origin_plant: string | null
          pallets: number | null
          pedido: string | null
          planned_at: string | null
          recibidos: number | null
          sin_aviso: boolean | null
          status: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "inbound_progress"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cambiar_rol: {
        Args: { p_id: string; p_role: Database["public"]["Enums"]["user_role"] }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          roles_extra: Database["public"]["Enums"]["user_role"][]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      carga_inicial_de: {
        Args: { p_codigo: string }
        Returns: {
          cajas: number
          en_picking: boolean
          lote: string
          posicion: string
          vence: string
        }[]
      }
      cargar_inicial: {
        Args: {
          p_codigo: string
          p_expiry: string
          p_lot: string
          p_pallet_code?: string
          p_posicion: string
          p_qty_cases: number
        }
        Returns: {
          aviso: string
          cases: number
          matricula: string
          posicion: string
          product_name: string
          sku: string
        }[]
      }
      cerrar_conteo: {
        Args: { p_task_id: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          closed_reason: string | null
          completed_at: string | null
          created_at: string
          expiry_date: string | null
          flow: string | null
          from_location_id: string | null
          id: string
          lot: string | null
          lpn_id: string | null
          min_level: number | null
          packaging_level_id: string | null
          priority: number
          product_id: string | null
          qty_base: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cerrar_ingreso_sin_aviso: {
        Args: { p_pedido: string }
        Returns: {
          created_at: string
          entrega: string | null
          goods_issue: string | null
          id: string
          mix: string | null
          nota: string | null
          origin_plant: string | null
          pedido: string
          planned_at: string | null
          sin_aviso: boolean
          status: string
          tabulado: string | null
          transporte: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inbound_doc"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cerrar_turno: { Args: never; Returns: number }
      claim_next_task: {
        Args: {
          p_types?: Database["public"]["Enums"]["task_type"][]
          p_zone_ids?: string[]
        }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          closed_reason: string | null
          completed_at: string | null
          created_at: string
          expiry_date: string | null
          flow: string | null
          from_location_id: string | null
          id: string
          lot: string | null
          lpn_id: string | null
          min_level: number | null
          packaging_level_id: string | null
          priority: number
          product_id: string | null
          qty_base: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_task: {
        Args: {
          p_reason?: string
          p_status: Database["public"]["Enums"]["task_status"]
          p_task_id: string
        }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          closed_reason: string | null
          completed_at: string | null
          created_at: string
          expiry_date: string | null
          flow: string | null
          from_location_id: string | null
          id: string
          lot: string | null
          lpn_id: string | null
          min_level: number | null
          packaging_level_id: string | null
          priority: number
          product_id: string | null
          qty_base: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_pick: {
        Args: {
          p_barcode: string
          p_cajas: number
          p_sueltas?: number
          p_task_id: string
        }
        Returns: {
          pedido: number
          surtido: number
          texto: string
        }[]
      }
      complete_putaway: {
        Args: { p_location_code: string; p_task_id: string }
        Returns: {
          era_la_sugerida: boolean
          location_code: string
        }[]
      }
      conceder_roles: {
        Args: {
          p_id: string
          p_roles: Database["public"]["Enums"]["user_role"][]
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          roles_extra: Database["public"]["Enums"]["user_role"][]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contar_retornable: {
        Args: { p_delta: number; p_note?: string; p_posicion: string }
        Returns: {
          posicion: string
          quedan: number
          uso: string
        }[]
      }
      crossdock: {
        Args: { p_anden?: string; p_lpn_code: string; p_order_id: string }
        Returns: {
          anden: string
          cajas: number
          etiqueta: string
        }[]
      }
      crossdock_posible: {
        Args: { p_lpn_code: string }
        Returns: {
          anden: string
          etiqueta: string
          faltan_cajas: number
          order_id: string
        }[]
      }
      current_role_name: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      dar_de_baja: {
        Args: { p_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          roles_extra: Database["public"]["Enums"]["user_role"][]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      desglose: {
        Args: { p_product_id: string; p_qty: number }
        Returns: {
          cajas: number
          por_caja: number
          sueltas: number
        }[]
      }
      despachar: {
        Args: { p_forzar?: boolean; p_nota?: string; p_order_id: string }
        Returns: undefined
      }
      destino_valido: {
        Args: { p_codigo: string }
        Returns: {
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
          reserved_by_task_id: string | null
          reserved_until: string | null
          retired_at: string | null
          status: Database["public"]["Enums"]["location_status"]
          updated_at: string
          usage_code: string
        }
        SetofOptions: {
          from: "*"
          to: "location"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      es_rol_de_trabajo: {
        Args: { p_rol: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      existencia_de: {
        Args: { p_texto: string }
        Returns: {
          area_code: string | null
          area_name: string | null
          base_code: string | null
          cajas: number | null
          disponible: number | null
          expiry_date: string | null
          id: string | null
          level: number | null
          location_code: string | null
          location_id: string | null
          lot: string | null
          lpn_code: string | null
          lpn_id: string | null
          name: string | null
          por_caja: number | null
          product_id: string | null
          qty_allocated: number | null
          qty_base: number | null
          sku: string | null
          sueltas: number | null
          zone_code: string | null
          zone_kind: Database["public"]["Enums"]["zone_type"] | null
        }[]
        SetofOptions: {
          from: "*"
          to: "inventario"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      falta_del_camion: { Args: { p_order_id: string }; Returns: number }
      falta_para_despacho: {
        Args: { p_product_id: string }
        Returns: {
          anden: string
          etiqueta: string
          falta: number
          order_id: string
        }[]
      }
      faltante_de_despachos: {
        Args: never
        Returns: {
          camiones: number
          falta: number
          nombre: string
          product_id: string
          sku: string
        }[]
      }
      flujo_de: { Args: { p_profile_id: string }; Returns: string }
      generate_zone_locations: {
        Args: { p_zone_code: string }
        Returns: number
      }
      has_role: {
        Args: { roles: Database["public"]["Enums"]["user_role"][] }
        Returns: boolean
      }
      hay_en: {
        Args: { p_texto: string }
        Returns: {
          expiry_date: string
          location_code: string
          location_id: string
          lot: string
          lpn_code: string
          lpn_id: string
          nombre: string
          product_id: string
          qty_allocated: number
          qty_base: number
          sku: string
          stock_id: string
        }[]
      }
      iniciar_turno: {
        Args: {
          p_flow?: string
          p_rol?: Database["public"]["Enums"]["user_role"]
          p_tipo_equipo?: string
        }
        Returns: {
          dock_door_id: string | null
          ended_at: string | null
          equipment_id: string | null
          equipment_type_code: string | null
          flow: string
          id: string
          pause_note: string | null
          paused_at: string | null
          profile_id: string
          started_at: string
          working_role: Database["public"]["Enums"]["user_role"] | null
        }
        SetofOptions: {
          from: "*"
          to: "shift_assignment"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lanzar_conteo: {
        Args: { p_area?: string; p_nivel?: number; p_zona?: string }
        Returns: {
          personas: number
          repartidas: number
          tareas: number
        }[]
      }
      listar_correos: {
        Args: never
        Returns: {
          created_at: string
          email: string
          nota: string
          ya_registrado: boolean
        }[]
      }
      listar_personal: {
        Args: never
        Returns: {
          approved_at: string
          created_at: string
          email: string
          employee_code: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          roles_extra: Database["public"]["Enums"]["user_role"][]
        }[]
      }
      lpn_contenido: {
        Args: { p_lpn_id: string }
        Returns: {
          code: string
          depth: number
          level: Database["public"]["Enums"]["packaging_code"]
          lpn_id: string
        }[]
      }
      manda_sobre_personal: { Args: never; Returns: boolean }
      pallets_que_caben: {
        Args: { p_location_id: string; p_product_id: string }
        Returns: number
      }
      pausar_turno: {
        Args: { p_motivo?: string }
        Returns: {
          dock_door_id: string | null
          ended_at: string | null
          equipment_id: string | null
          equipment_type_code: string | null
          flow: string
          id: string
          pause_note: string | null
          paused_at: string | null
          profile_id: string
          started_at: string
          working_role: Database["public"]["Enums"]["user_role"] | null
        }
        SetofOptions: {
          from: "*"
          to: "shift_assignment"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      posiciones_a_contar: {
        Args: { p_area?: string; p_nivel?: number; p_zona?: string }
        Returns: {
          location_id: string
          nivel: number
          paso: number
          zone_id: string
        }[]
      }
      posiciones_como: { Args: { p_patron: string }; Returns: string[] }
      posiciones_donde: {
        Args: { p_nivel?: number; p_patron?: string; p_zona?: string }
        Returns: string[]
      }
      post_movement: {
        Args: {
          p_desprende?: boolean
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
      producto_para_recibir: {
        Args: { p_codigo: string }
        Returns: {
          case_id: string
          name: string
          product_id: string
          requires_fefo: boolean
          sku: string
        }[]
      }
      producto_por_codigo: { Args: { p_codigo: string }; Returns: string }
      puede_trabajar_como: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      quitar_correo: { Args: { p_email: string }; Returns: string }
      reactivar_persona: {
        Args: { p_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_code: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          roles_extra: Database["public"]["Enums"]["user_role"][]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reanudar_turno: {
        Args: never
        Returns: {
          dock_door_id: string | null
          ended_at: string | null
          equipment_id: string | null
          equipment_type_code: string | null
          flow: string
          id: string
          pause_note: string | null
          paused_at: string | null
          profile_id: string
          started_at: string
          working_role: Database["public"]["Enums"]["user_role"] | null
        }
        SetofOptions: {
          from: "*"
          to: "shift_assignment"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reasignar_area: {
        Args: { p_area_code: string; p_location_ids: string[] }
        Returns: number
      }
      reasignar_area_donde: {
        Args: {
          p_area_code: string
          p_nivel?: number
          p_patron?: string
          p_zona?: string
        }
        Returns: number
      }
      reasignar_area_por_codigo: {
        Args: { p_area_code: string; p_patron: string }
        Returns: number
      }
      reasignar_uso: {
        Args: { p_location_ids: string[]; p_usage_code: string }
        Returns: number
      }
      reasignar_uso_donde: {
        Args: {
          p_nivel?: number
          p_patron?: string
          p_usage_code: string
          p_zona?: string
        }
        Returns: number
      }
      reasignar_uso_por_codigo: {
        Args: { p_patron: string; p_usage_code: string }
        Returns: number
      }
      receive_pallet: {
        Args: {
          p_cases: number
          p_dock_location_id: string
          p_expiry?: string
          p_idempotency_key?: string
          p_lot?: string
          p_lpn_code: string
          p_max_level?: number
          p_packaging_level_id: string
          p_product_id: string
        }
        Returns: {
          lpn_code: string
          lpn_id: string
          task_id: string
          to_location_code: string
          to_location_id: string
        }[]
      }
      rechazar_registro: { Args: { p_id: string }; Returns: undefined }
      recibir_del_documento: {
        Args: {
          p_barcode?: string
          p_dock_location_id: string
          p_max_level?: number
          p_pallet_code: string
          p_pedido: string
        }
        Returns: {
          cases: number
          lpn_code: string
          pallets: number
          product_name: string
          recibidos: number
          sku: string
          to_location_code: string
        }[]
      }
      recibir_sin_aviso: {
        Args: {
          p_codigo: string
          p_dock_location_id: string
          p_expiry?: string
          p_lot?: string
          p_max_level?: number
          p_pallet_code?: string
          p_pedido: string
          p_qty_cases: number
        }
        Returns: {
          cases: number
          lpn_code: string
          pallets: number
          product_name: string
          recibidos: number
          sku: string
          to_location_code: string
        }[]
      }
      recontar: {
        Args: {
          p_cajas: number
          p_lugar: string
          p_nota?: string
          p_pallet?: string
          p_sueltas?: number
          p_task_id?: string
        }
        Returns: {
          de_donde: string
          decia: number
          decia_sueltas: number
          diferencia: number
          falta: number
          habia: number
          habia_sueltas: number
          por_caja: number
          tareas: number
        }[]
      }
      release_order: { Args: { p_order_id: string }; Returns: number }
      reordenar: {
        Args: { p_destino: string; p_origen: string; p_pallet?: string }
        Returns: {
          a: string
          cantidad: number
          de: string
          nombre: string
          pallet: string
          sku: string
        }[]
      }
      rol_asignable: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      rol_de_trabajo: {
        Args: { p_profile_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      roles_de_la_sesion: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"][]
      }
      soltar_lo_no_empezado: { Args: never; Returns: number }
      soltar_tareas_del_turno: { Args: never; Returns: number }
      start_pick: {
        Args: { p_location_code: string; p_task_id: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          closed_reason: string | null
          completed_at: string | null
          created_at: string
          expiry_date: string | null
          flow: string | null
          from_location_id: string | null
          id: string
          lot: string | null
          lpn_id: string | null
          min_level: number | null
          packaging_level_id: string | null
          priority: number
          product_id: string | null
          qty_base: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_putaway: {
        Args: { p_lpn_code: string; p_task_id: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          closed_reason: string | null
          completed_at: string | null
          created_at: string
          expiry_date: string | null
          flow: string | null
          from_location_id: string | null
          id: string
          lot: string | null
          lpn_id: string | null
          min_level: number | null
          packaging_level_id: string | null
          priority: number
          product_id: string | null
          qty_base: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_task: {
        Args: { p_task_id: string }
        Returns: {
          assigned_at: string | null
          assigned_to: string | null
          closed_reason: string | null
          completed_at: string | null
          created_at: string
          expiry_date: string | null
          flow: string | null
          from_location_id: string | null
          id: string
          lot: string | null
          lpn_id: string | null
          min_level: number | null
          packaging_level_id: string | null
          priority: number
          product_id: string | null
          qty_base: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          to_location_id: string | null
          type: Database["public"]["Enums"]["task_type"]
          wave_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "task"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sugerir_posicion_inicial: {
        Args: { p_codigo: string; p_expiry?: string }
        Returns: {
          code: string
          es_picking: boolean
          location_id: string
        }[]
      }
      suggest_putaway_location: {
        Args: {
          p_expiry?: string
          p_lot?: string
          p_max_level?: number
          p_product_id: string
        }
        Returns: string
      }
      texto_cajas: {
        Args: { p_por_caja: number; p_qty: number }
        Returns: string
      }
      trabajar_como: {
        Args: { p_rol: Database["public"]["Enums"]["user_role"] }
        Returns: {
          dock_door_id: string | null
          ended_at: string | null
          equipment_id: string | null
          equipment_type_code: string | null
          flow: string
          id: string
          pause_note: string | null
          paused_at: string | null
          profile_id: string
          started_at: string
          working_role: Database["public"]["Enums"]["user_role"] | null
        }
        SetofOptions: {
          from: "*"
          to: "shift_assignment"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unidades_por: { Args: { p_packaging_level_id: string }; Returns: number }
      verificar_linea: {
        Args: { p_codigo: string; p_order_id: string }
        Returns: {
          linea: number
          nombre: string
          sku: string
          ya_estaba: boolean
        }[]
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
      order_status:
        | "DRAFT"
        | "RELEASED"
        | "PICKING"
        | "PICKED"
        | "SHIPPED"
        | "CANCELLED"
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
      task_status:
        | "READY"
        | "ASSIGNED"
        | "IN_PROGRESS"
        | "DONE"
        | "CANCELLED"
        | "BLOCKED"
      task_type:
        | "PUTAWAY"
        | "PICK"
        | "REPLENISH"
        | "MOVE"
        | "COUNT"
        | "RELOCATE"
      uom_kind: "count" | "weight" | "volume" | "length"
      user_role:
        | "auxiliar"
        | "chequeador"
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
      order_status: [
        "DRAFT",
        "RELEASED",
        "PICKING",
        "PICKED",
        "SHIPPED",
        "CANCELLED",
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
      task_status: [
        "READY",
        "ASSIGNED",
        "IN_PROGRESS",
        "DONE",
        "CANCELLED",
        "BLOCKED",
      ],
      task_type: ["PUTAWAY", "PICK", "REPLENISH", "MOVE", "COUNT", "RELOCATE"],
      uom_kind: ["count", "weight", "volume", "length"],
      user_role: [
        "auxiliar",
        "chequeador",
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
