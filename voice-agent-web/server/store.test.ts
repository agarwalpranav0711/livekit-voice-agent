import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalStore } from './store.js'
import { defaultAssistantSettings } from './settings.js'

test('conversation records and transcripts persist separately and delete with cascade', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aural-history-'))
  const databasePath = join(directory, 'history.sqlite')
  const first = new LocalStore(databasePath)
  try {
    first.createConversation('owner-one', 'conversation-one', { ...defaultAssistantSettings })
    first.createConversation('owner-one', 'conversation-two', { ...defaultAssistantSettings })
    first.saveSettings('owner-one', {
      ...defaultAssistantSettings,
      assistantName: 'Mira',
      language: 'hi',
    })
    first.addTranscript('owner-one', 'conversation-one', [
      { segmentId: 'u1', speaker: 'You', text: 'First conversation text.' },
    ])
    first.addTranscript('owner-one', 'conversation-two', [
      { segmentId: 'u2', speaker: 'You', text: 'Second conversation text.' },
    ])
    first.close()

    const reopened = new LocalStore(databasePath)
    try {
      const history = reopened.listConversations('owner-one')
      assert.equal(history.length, 2)
      assert.equal(reopened.getSettings('owner-one').settings.assistantName, 'Mira')
      assert.equal(reopened.getSettings('owner-one').settings.language, 'hi')
      assert.deepEqual(reopened.getConversation('owner-one', 'conversation-one')?.transcript.map((line) => line.text), [
        'First conversation text.',
      ])
      assert.deepEqual(reopened.getConversation('owner-one', 'conversation-two')?.transcript.map((line) => line.text), [
        'Second conversation text.',
      ])
      assert.equal(reopened.listConversations('owner-two').length, 0)
      assert.equal(reopened.deleteConversation('owner-one', 'conversation-one'), true)
      assert.equal(reopened.getConversation('owner-one', 'conversation-one'), null)
      assert.equal(reopened.clearConversations('owner-one'), 1)
      assert.equal(reopened.listConversations('owner-one').length, 0)
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
