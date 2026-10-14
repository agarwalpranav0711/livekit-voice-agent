import { z } from 'zod'

export const defaultAssistantSettings = {
  assistantName: 'Aural',
  personality: 'friendly',
  greeting: 'Hello! What would you like to talk about?',
  language: 'en',
  responseStyle: 'short',
  customInstructions: '',
} as const

const unsafeInstructionPattern = /(?:reveal|show|print|output|expose|repeat|dump|disclose|share|tell me|give me|list).{0,100}(?:api[\s_-]*key|secret|credential|access[\s_-]*token|environment(?:\s+variables?)?|env\s+vars?|\.env|system prompt|internal instruction|private configuration)|(?:api[\s_-]*key|secret|credential|access[\s_-]*token|environment(?:\s+variables?)?|env\s+vars?|\.env|system prompt|internal instruction|private configuration).{0,100}(?:reveal|show|print|output|expose|repeat|dump|disclose|share|tell me|give me|list)|(?:sk-[A-Za-z0-9_-]{16,}|(?:api[\s_-]*key|secret|token)\s*[:=]\s*\S+)|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i

function safeUserText(value: string) {
  return !unsafeInstructionPattern.test(value)
    && !/\b(?:LIVEKIT_API_SECRET|LIVEKIT_API_KEY|WEB_ACCESS_PASSWORD)\b/i.test(value)
}

export const assistantSettingsSchema = z.object({
  assistantName: z.string().trim().min(1).max(48).refine(safeUserText, 'Do not include credentials or requests to reveal private configuration.'),
  personality: z.enum(['friendly', 'professional', 'concise', 'humorous']),
  greeting: z.string().trim().min(1).max(240).refine(safeUserText, 'Do not include credentials or requests to reveal private configuration.'),
  language: z.enum(['en', 'es', 'fr', 'hi', 'de', 'ja']),
  responseStyle: z.enum(['short', 'detailed']),
  customInstructions: z.string().trim().max(1000).refine(safeUserText, 'Do not request private credentials or internal configuration.'),
}).strict()

export type AssistantSettings = z.infer<typeof assistantSettingsSchema>

export function parseAssistantSettings(value: unknown): AssistantSettings {
  return assistantSettingsSchema.parse(value)
}
