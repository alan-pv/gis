/** The contract between the agent (sidecar) and the board: envelope, operations and canvas state. */
export { SCHEMA_VERSION, CanvasStateSchema } from './state.js'
export type { CanvasObject, CanvasState } from './state.js'
export { RoleSchema, OperationSchema } from './operations.js'
export type { Role, ObjectKind, ConnectStyle, Operation } from './operations.js'
export { EnvelopeSchema, LenientEnvelopeSchema } from './envelope.js'
