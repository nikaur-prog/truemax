export interface FeedbackAnalysisRow {
  review_status?: string;
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
