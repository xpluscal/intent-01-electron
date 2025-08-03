export interface AgentOption {
  key: 'claude' | 'gemini'
  displayName: string
  enabled: boolean
  description?: string
}

export const AVAILABLE_AGENTS: AgentOption[] = [
  {
    key: 'claude',
    displayName: 'Claude',
    enabled: true,
    description: 'Anthropic\'s Claude AI assistant'
  },
  {
    key: 'gemini',
    displayName: 'Gemini',
    enabled: false,
    description: 'Google\'s Gemini AI (coming soon)'
  }
]

export const DEFAULT_AGENT = 'claude'

export function getEnabledAgents(): AgentOption[] {
  return AVAILABLE_AGENTS.filter(agent => agent.enabled)
}

export function getAgentByKey(key: string): AgentOption | undefined {
  return AVAILABLE_AGENTS.find(agent => agent.key === key)
}

export function isValidAgent(key: string): boolean {
  const agent = getAgentByKey(key)
  return agent?.enabled ?? false
}