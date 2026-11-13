/**
 * Output envelope of the agent.
 *
 * Two schemas:
 *   - `EnvelopeSchema`: strict, validates every operation against the discriminated union.
 *   - `LenientEnvelopeSchema`: validates the envelope with `operations: unknown[]`, so the
 *     validator can iterate op by op and drop only the malformed ones.
 */
import { z } from 'zod'
import { OperationSchema } from './operations.js'
import { SCHEMA_VERSION } from './state.js'

export const EnvelopeSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  operations: z.array(OperationSchema),
})

export const LenientEnvelopeSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  operations: z.array(z.unknown()),
})
