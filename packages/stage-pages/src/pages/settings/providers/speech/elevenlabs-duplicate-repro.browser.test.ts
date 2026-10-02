import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App, Component } from 'vue'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { injectKeyPiniaSynced } from '@proj-airi/stage-ui/libs/pinia'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import ElevenLabsPage from './elevenlabs.vue'

import 'virtual:uno.css'

const contexts: Array<{
  app?: App
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
}> = []

function createSyncedPinia(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({
    callTimeout: 5000,
    leadership,
    namespace,
  })
  pinia.use(runtime.plugin)
  contexts.push({ pinia, runtime })
  return { pinia, runtime }
}

async function mountFollower(component: Component, pinia: ReturnType<typeof createPinia>, runtime: SyncedPiniaRuntime) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  await render(component, {
    global: {
      plugins: [
        pinia,
        PiniaColada,
        createI18n({ legacy: false, locale: 'en', messages: { en } }),
        router,
      ],
      provide: {
        [injectKeyPiniaSynced as symbol]: runtime,
      },
      directives: { motion: {} },
    },
  })
}

afterEach(() => {
  for (const { app, pinia, runtime } of contexts) {
    app?.unmount()
    runtime.dispose()
    disposePinia(pinia)
  }
  contexts.length = 0
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('elevenlabs returning-user duplicate voice load repro', () => {
  // https://github.com/moeru-ai/airi/issues/2523
  // ROOT CAUSE:
  //
  // When a returning user opens the ElevenLabs settings page with the provider
  // status already `configured`, SpeechProviderSettings loads voices once during
  // onMounted, while the page-level watchDebounced(apiKey/baseUrl, immediate)
  // schedules a second load 500ms later. The voice-list request cache only
  // coalesces in-flight requests and deletes the key when done, so a first
  // request that completes within the 500ms window is followed by a duplicate
  // provider request.
  //
  // The existing PR #2525 regression seeds an empty key and patches it after
  // mount (fresh-user path), so it never covers this returning-configured-user
  // path. The duplicate-load concern itself came from Codex review (P2); this
  // test is fresh reproducible evidence on the latest PR head after that
  // thread was marked resolved.
  it('loads the voice catalog once for an already-configured provider (Issue #2523 / PR #2525 P2)', async () => {
    localStorage.clear()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ voices: [{
      id: 'repro-voice',
      languages: ['en'],
      name: 'Repro Voice',
      preview_audio_url: 'https://voices.invalid/repro.mp3',
    }] }))
    vi.stubGlobal('fetch', fetch)

    const namespace = `elevenlabs-dup:${crypto.randomUUID()}`
    const leaderPinia = createPinia()
    const leaderRuntime = createSyncedPiniaPlugin({ callTimeout: 5000, leadership: 'leader-only', namespace })
    leaderPinia.use(leaderRuntime.plugin)
    contexts.push({ pinia: leaderPinia, runtime: leaderRuntime })
    let leaderSpeech!: ReturnType<typeof useSpeechStore>
    const leaderApp = createApp({
      setup() {
        leaderSpeech = useSpeechStore()
        useProviderConfigStore()
        return () => null
      },
    })
    leaderApp
      .provide(injectKeyPiniaSynced, leaderRuntime)
      .use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
      .use(leaderPinia)
      .use(PiniaColada)
      .mount(document.createElement('div'))
    contexts.at(-1)!.app = leaderApp
    await vi.waitFor(() => expect(leaderRuntime.isLeader()).toBe(true))

    const leaderConfig = useProviderConfigStore(leaderPinia)
    await leaderConfig.ensureProvider('elevenlabs', 'elevenlabs', {
      apiKey: 'sk-repro',
      baseUrl: 'https://voices.invalid/v1/',
    })
    leaderConfig.setProviderStatus('elevenlabs', 'configured')

    const follower = createSyncedPinia(namespace, 'follower-only')
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leaderRuntime.participantId))
    const followerConfig = useProviderConfigStore(follower.pinia)
    await vi.waitFor(() => expect(followerConfig.getProviderConfig('elevenlabs')?.apiKey).toBe('sk-repro'))
    await vi.waitFor(() => expect(followerConfig.providers.elevenlabs?.status).toBe('configured'))

    fetch.mockClear()
    await mountFollower(ElevenLabsPage, follower.pinia, follower.runtime)

    await vi.waitFor(() => expect(leaderSpeech.availableVoices.elevenlabs?.[0]?.id).toBe('repro-voice'), { timeout: 15000 })
    await new Promise(resolve => setTimeout(resolve, 1200))
    const count = fetch.mock.calls.length
    expect(count).toBe(1)
  }, 60000)
})
