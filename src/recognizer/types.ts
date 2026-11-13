/**
 * Public types of the $P figure recognizer.
 *
 * Pure module: no DOM, Konva or React.
 */

/** A point of a $P cloud; strokeId identifies the stroke it belongs to. */
export interface CloudPoint { x: number; y: number; strokeId: number }

/** Normalized template ready to compare against. */
export interface RecognizerTemplate { name: string; points: CloudPoint[] }

/** Candidate returned by recognize, score in [0,1]. */
export interface RecognizerCandidate { name: string; score: number }
