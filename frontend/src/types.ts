export type Pointage = {
  t_start: number;
  t_end: number;
  t_center: number;
  duration: number;
  x_pixel: number;
  y_pixel: number;
  n_frames: number;
  color: string;
  row: number | null;
  col: number | null;
  grid_xy: [number, number];
  case_id_geometrique: string | null;
  label: string | null;
  audio_segments: { text: string; start: number; end: number }[];
};

export type ProcessResult = {
  session_id: string;
  video_filename: string;
  couleur_pastille_detectee: "fuchsia" | "green_fluo";
  color_stats: { fuchsia: { detected: number; ratio: number }; green_fluo: { detected: number; ratio: number } };
  pointages: Pointage[];
  audio_transcript: { text: string; language: string; segments: { text: string; start: number; end: number }[] };
  case_sequence: (string | null)[];
  label_sequence: (string | null)[];
  propositions: string[];
  claude_error: string | null;
};
