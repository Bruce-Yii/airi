/**
 * Assistant output projection contract (spike for #2432 / #2255).
 *
 * Sits after response categorisation and before content/TTS/persistence fan-out:
 * it derives the conversation (persist + provider prompt), display (bubble) and
 * speech (TTS) views from one categorized turn plus character/app annotations.
 * Model reasoning and annotations never enter a projection unless a policy
 * explicitly allows it, so history and provider prompts stay free of
 * chain-of-thought and app metadata by default. No markup syntax is parsed or
 * produced here; syntax belongs to feature/plugin policy, not this seam.
 */

/** Character- or app-provided note attached to a turn. Never model reasoning. */
export interface AssistantAnnotation {
  /** Producer of the note. Model chain-of-thought must not use this channel. */
  source: 'character' | 'app'
  /** Stable key, e.g. 'emotion' or 'motion-cue'. */
  key: string
  /** Human-readable note text. */
  text: string
}

/** Categorized turn plus annotations entering the projector. */
export interface AssistantProjectionInput {
  /** Spoken/visible text after categorisation. */
  speech: string
  /** Model reasoning. Excluded from every projection by every policy. */
  reasoning: string
  /** Character/app annotations. Excluded unless a policy allows them. */
  annotations: AssistantAnnotation[]
}

/** Per-consumer views derived from one turn. */
export interface AssistantProjection {
  /** Persisted history and provider-prompt view. Must stay prompt-safe. */
  conversation: string
  /** Chat-bubble view. */
  display: string
  /** TTS input view. */
  speech: string
}

/** Which surfaces may carry annotations. Conversation and speech never do. */
export interface AssistantProjectionPolicy {
  /**
   * Where annotations may appear.
   * @default 'hide'
   */
  annotations?: 'hide' | 'display'
}

const defaultPolicy: Required<AssistantProjectionPolicy> = { annotations: 'hide' }

/**
 * Derives per-consumer views for one assistant turn.
 *
 * The default policy reproduces current pipeline behavior exactly: every view
 * carries the categorized speech text, while reasoning and annotations are
 * dropped. Policies may surface annotations into display only; conversation
 * and speech stay annotation-free so history, provider prompts and TTS input
 * cannot leak app metadata or chain-of-thought.
 */
export function projectAssistantOutput(
  input: AssistantProjectionInput,
  policy: AssistantProjectionPolicy = defaultPolicy,
): AssistantProjection {
  const annotations = policy.annotations === 'display'
    ? input.annotations
        .filter(annotation => annotation.text.trim())
        .map(annotation => `[${annotation.key}: ${annotation.text.trim()}]`)
    : []
  const display = annotations.length > 0 ? `${input.speech}\n${annotations.join('\n')}` : input.speech
  return {
    conversation: input.speech,
    display,
    speech: input.speech,
  }
}
