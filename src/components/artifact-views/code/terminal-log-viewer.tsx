'use client';

import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface TerminalLogViewerProps {
  logs: string[];
  className?: string;
}

// Parse log and extract the core message
function extractCoreMessage(logString: string): { message: string; type: 'info' | 'success' | 'error' | 'warning' | 'system' } {
  try {
    // Handle format: [timestamp] [type] content
    const match = logString.match(/^\[([^\]]+)\] \[([^\]]+)\] (.+)$/);
    if (!match) return { message: logString, type: 'info' };
    
    const [, , logType, content] = match;
    
    // Try to parse JSON content
    try {
      const parsed = JSON.parse(content);
      
      // Extract meaningful messages based on log type
      if (parsed.type === 'assistant' && parsed.message?.content) {
        // Extract text from assistant messages
        const textParts = parsed.message.content
          .filter((item: any) => item.type === 'text')
          .map((item: any) => item.text)
          .join('\n');
        
        if (textParts) {
          return { message: textParts, type: 'info' };
        }
      }
      
      // Handle tool use
      if (parsed.type === 'assistant' && parsed.message?.content) {
        const toolUse = parsed.message.content.find((item: any) => item.type === 'tool_use');
        if (toolUse) {
          const toolMessages: Record<string, string> = {
            'Read': `📖 Reading ${toolUse.input?.file_path || 'file'}`,
            'Write': `✍️ Writing to ${toolUse.input?.file_path || 'file'}`,
            'Edit': `✏️ Editing ${toolUse.input?.file_path || 'file'}`,
            'MultiEdit': `📝 Making multiple edits to ${toolUse.input?.file_path || 'file'}`,
            'Bash': `💻 ${toolUse.input?.command || 'Running command'}`,
            'Grep': `🔍 Searching for: ${toolUse.input?.pattern || 'pattern'}`,
            'Glob': `🔍 Finding files: ${toolUse.input?.pattern || 'pattern'}`,
            'TodoWrite': `✅ Updating todo list`,
            'Task': `🤖 ${toolUse.input?.description || 'Running task'}`,
            'WebSearch': `🌐 Searching web for: ${toolUse.input?.query || 'query'}`
          };
          const message = toolMessages[toolUse.name] || `🔧 Using ${toolUse.name}`;
          return { message, type: 'system' };
        }
      }
      
      // Handle system messages
      if (parsed.type === 'system') {
        if (parsed.subtype === 'init') {
          return { message: '🚀 Execution started', type: 'success' };
        }
        if (parsed.subtype === 'phase') {
          const phaseMessages: Record<string, string> = {
            'starting': '🎬 Starting execution...',
            'copying_files': '📁 Setting up workspace...',
            'creating_apps': '🏗️ Creating applications...',
            'executing': '⚡ Running AI agent...',
            'completed': '✅ Execution completed',
            'failed': '❌ Execution failed'
          };
          return { 
            message: phaseMessages[parsed.phase] || `Phase: ${parsed.phase}`, 
            type: parsed.phase === 'failed' ? 'error' : 'system' 
          };
        }
      }
      
      // Handle results
      if (parsed.type === 'result') {
        const duration = parsed.duration_ms ? ` (${(parsed.duration_ms / 1000).toFixed(1)}s)` : '';
        return { message: `✅ Execution completed${duration}`, type: 'success' };
      }
      
      // Handle errors
      if (parsed.type === 'error' || logType === 'error') {
        return { message: `❌ ${parsed.message || parsed.error || 'Error occurred'}`, type: 'error' };
      }
      
      // Skip user messages (tool results) as they're usually verbose
      if (parsed.type === 'user') {
        return { message: '', type: 'info' };
      }
      
    } catch {
      // Not JSON, return as is
      return { message: content, type: 'info' };
    }
    
    return { message: '', type: 'info' };
  } catch {
    return { message: logString, type: 'info' };
  }
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'success': return 'text-green-400';
    case 'error': return 'text-red-400';
    case 'warning': return 'text-yellow-400';
    case 'system': return 'text-blue-400';
    default: return 'text-gray-300';
  }
}

export function TerminalLogViewer({ logs, className }: TerminalLogViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Extract messages from logs
  const messages = logs
    .map(log => extractCoreMessage(log))
    .filter(({ message }) => message.trim() !== '');

  return (
    <div className={cn("flex flex-col bg-gray-900 rounded-lg select-text overflow-hidden", className)}>
      {/* Terminal Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-sm text-gray-400 font-mono ml-2">Execution Logs</span>
      </div>
      
      {/* Terminal Body */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
        <div className="p-4 font-mono text-sm">
          {messages.length === 0 ? (
            <div className="text-gray-500">
              <div className="mb-2">$ claude-code execute</div>
              <div className="text-gray-600">Waiting for logs...</div>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map(({ message, type }, index) => (
                <div key={index} className={cn("leading-relaxed", getTypeColor(type))}>
                  {message.split('\n').map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}