import { getEnabledAgents } from '@/lib/agents'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select'

interface AgentSelectorProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function AgentSelector({ value, onValueChange, disabled, className }: AgentSelectorProps) {
  const enabledAgents = getEnabledAgents()
  
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select an agent" />
      </SelectTrigger>
      <SelectContent>
        {enabledAgents.map((agent) => (
          <SelectItem key={agent.key} value={agent.key}>
            <div className="flex flex-col">
              <span>{agent.displayName}</span>
              {agent.description && (
                <span className="text-xs text-muted-foreground">{agent.description}</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}