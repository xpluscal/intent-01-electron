# Design System

## Our Design Approach

### Keep Users in Mind
- Design for the task, not for the sake of design
- If users need to think about how to use it, it's too complex
- Test with real people when possible
- Make the common case fast and easy

### Visual Basics
- Use plenty of white space - let the design breathe
- Stick to our color palette - don't invent new colors
- Keep text readable - minimum 14px for body text
- Make buttons look clickable and links look clickable

### Consistency Matters
- Similar things should look similar
- Use the same pattern for the same action
- Don't reinvent components that already exist
- Follow platform conventions (e.g., iOS vs Android)

## Component Guidelines

### Forms
- Label every field clearly
- Put labels above fields, not beside them
- Show errors next to the relevant field
- Make required fields obvious
- Provide helpful placeholder text

### Buttons
- Primary action = primary button (only one per screen)
- Destructive actions should look dangerous (red)
- Disable buttons during loading
- Make touch targets at least 44x44px on mobile

### Feedback
- Show loading states for anything over 0.5 seconds
- Confirm successful actions (but don't overdo it)
- Error messages should explain how to fix the problem
- Use animation sparingly and purposefully

### Navigation
- Users should always know where they are
- Back button should always work as expected
- Maximum 3 levels deep in navigation
- Important actions within 2 clicks/taps

## Layout Rules

### Mobile First
- Design for phones first, then scale up
- Touch targets need to be finger-friendly
- Consider one-handed use
- Test on real devices, not just browser tools

### Information Hierarchy
- Most important info goes at the top
- Group related items together
- Use headings to break up long content
- Progressive disclosure - don't show everything at once

### Accessibility
- Color shouldn't be the only way to convey information
- All images need alt text
- Ensure keyboard navigation works
- Test with screen readers

## Working Together

### Design Handoff
- Provide all states (default, hover, active, disabled)
- Include edge cases (empty states, errors)
- Specify exact colors and spacing
- Note any animations or transitions

### Common Patterns We Use
- Cards for grouping related content
- Modals for focused tasks
- Toast notifications for temporary messages
- Inline validation for forms
- Skeleton screens while loading

## Quick Checks

Before calling a design done:
- [ ] Is it obvious what the user should do?
- [ ] Does it work on mobile?
- [ ] Are errors handled gracefully?
- [ ] Is it accessible?
- [ ] Does it match our existing patterns?

Remember: Good design should feel invisible. Users should focus on their goals, not on figuring out the interface.