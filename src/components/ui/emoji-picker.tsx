import { useState } from 'react'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

interface EmojiPickerProps {
  value?: string
  onChange: (emoji: string) => void
}

const EMOJI_CATEGORIES = {
  'Common': ['📁', '📂', '📄', '📝', '📋', '📊', '📈', '📉', '💼', '🎯', '🚀', '💡', '⭐', '🔥', '✨', '💎', '🏆', '🎨'],
  'Objects': ['📱', '💻', '🖥️', '⌨️', '🖱️', '🖨️', '📷', '📹', '🎬', '🎵', '🎸', '🎤', '🎧', '📡', '🔧', '🔨', '⚙️', '🗂️'],
  'Nature': ['🌟', '☀️', '🌙', '⚡', '🌈', '🌊', '🌺', '🌸', '🌼', '🌻', '🌿', '🌱', '🌳', '🌴', '🍀', '🦋', '🐝', '🦄'],
  'People': ['😊', '😎', '🤔', '👍', '👏', '🙌', '💪', '🧠', '👀', '👂', '👃', '👄', '🦾', '🤖', '👨‍💻', '👩‍💻', '🧑‍💼', '👥'],
  'Symbols': ['✅', '❌', '⚠️', '📌', '🔖', '🏷️', '🔗', '📎', '✂️', '📐', '📏', '🔍', '🔎', '🔓', '🔒', '🔑', '🛡️', '⚡']
}

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('Common')

  const handleSelect = (emoji: string) => {
    onChange(emoji)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size="icon"
          className="h-10 w-10 text-lg"
        >
          {value || '📁'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-2">
          <div className="flex gap-1 flex-wrap">
            {Object.keys(EMOJI_CATEGORIES).map(category => (
              <Button
                key={category}
                variant={selectedCategory === category ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedCategory(category)}
                className="text-xs"
              >
                {category}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_CATEGORIES[selectedCategory as keyof typeof EMOJI_CATEGORIES].map(emoji => (
              <Button
                key={emoji}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-lg hover:scale-110 transition-transform"
                onClick={() => handleSelect(emoji)}
              >
                {emoji}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}