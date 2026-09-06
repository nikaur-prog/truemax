export interface FeedbackAnalysisRow {
  review_status?: string;
  expires_at?: string;
  moved_point_ids?: string[];
  image_width?: number;
  image_height?: number;
  face_dir: number;
  automatic_points: Record<string, { x: number; y: number }>;
  corrected_points: Record<string, { x: number; y: number }>;
}

export function sideFeedbackOffsets(
  row: FeedbackAnalysisRow,
  pointIds: readonly string[],
): Record<string, { dx: number; dy: number }> | null;

export function sideFeedbackCalibrationOffsets(
  row: FeedbackAnalysisRow,
  pointIds: readonly string[],
  now?: number,
): Record<string, { dx: number; dy: number }> | null;

export function fetchSideFeedbackRows(
  url: string,
  key: string,
  options?: { fetcher?: typeof fetch; now?: string; pageSize?: number },
): Promise<Array<FeedbackAnalysisRow & { id: string; created_at: string }>>;
