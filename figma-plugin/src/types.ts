export type PipelineType = 'vector' | 'raster';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentStyle {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  font_size?: number;
  font_name?: string;
}

export interface ComponentManifestItem {
  id: string;
  type?: string;
  role?: string;
  content?: string;
  style?: ComponentStyle;
  bbox: BBox;
  image_bytes_b64?: string;
  image_width?: number;
  image_height?: number;
  svg_path?: string;
  is_background?: boolean;
  depth_order?: number;
}

export interface VectorPageManifest {
  page_number?: number;
  page_index?: number;
  width: number;
  height: number;
  components: ComponentManifestItem[];
}

export interface VectorManifest {
  pipeline_type: 'vector';
  pages: VectorPageManifest[];
}

export interface RasterManifest {
  pipeline_type?: 'raster';
  width?: number;
  height?: number;
  components: ComponentManifestItem[];
}

export type ComponentManifest = VectorManifest | RasterManifest;
