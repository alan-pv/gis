/** Speech module — public API (Web Speech API, phrase gate and utterance queue). */

// Deterministic gate heuristic — pure, no DOM
export { gateClause } from './gate.js'

// Fixed defaults of the continuous mode
export { EARLY_CUT_MS, MAX_PHRASE_MS } from './defaults.js'

// Web Speech API: push-to-talk + continuous
export { startWebSpeechPtt, startWebSpeechContinuous } from './webspeech.js'
export type { WebSpeechPttHandle, WebSpeechContinuousHandle, WebSpeechContinuousCallbacks } from './webspeech.js'
