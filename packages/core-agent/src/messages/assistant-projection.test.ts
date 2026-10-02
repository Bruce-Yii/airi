import { describe, expect, it } from 'vitest'

import { projectAssistantOutput } from './assistant-projection'

// Spike contract for https://github.com/moeru-ai/airi/issues/2432
// (inner thought vs spoken) and https://github.com/moeru-ai/airi/issues/2255
// (display text vs TTS pronunciation). No markup syntax is exercised here;
// the projector operates on already-categorized strings plus annotations.
describe('projectAssistantOutput', () => {
  it('reproduces current pipeline behavior by default', () => {
    expect(projectAssistantOutput({
      annotations: [],
      reasoning: '<inner_thought>jealous but hiding it</inner_thought>',
      speech: 'It is fine, go ahead.',
    })).toEqual({
      conversation: 'It is fine, go ahead.',
      display: 'It is fine, go ahead.',
      speech: 'It is fine, go ahead.',
    })
  })

  it('keeps model reasoning out of every projection', () => {
    const projected = projectAssistantOutput({
      annotations: [],
      reasoning: 'secret plan',
      speech: 'Hello.',
    })
    expect(`${projected.conversation}${projected.display}${projected.speech}`).not.toContain('secret plan')
  })

  it('surfaces annotations into display only when policy allows', () => {
    const input = {
      annotations: [{ key: 'emotion', source: 'character', text: 'pouting' } as const],
      reasoning: '',
      speech: 'No way.',
    }
    expect(projectAssistantOutput(input).display).toBe('No way.')
    const allowed = projectAssistantOutput(input, { annotations: 'display' })
    expect(allowed.display).toBe('No way.\n[emotion: pouting]')
    expect(allowed.conversation).toBe('No way.')
    expect(allowed.speech).toBe('No way.')
  })

  it('falls back safely on empty input', () => {
    expect(projectAssistantOutput({ annotations: [], reasoning: '', speech: '' })).toEqual({
      conversation: '',
      display: '',
      speech: '',
    })
  })
})
