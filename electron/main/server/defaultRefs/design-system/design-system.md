# Design System

## Core Principles

### Keep Users in Mind
- Design for the task, not for the sake of design
- If users need to think about how to use it, it's too complex
- Test with real people when possible
- Make the common case fast and easy

### Visual Hierarchy
- Use size, weight, and color to guide attention
- Most important info gets the most visual weight
- Group related items with proximity and borders
- Use consistent spacing throughout

## Layout Grid

### Desktop (1440px)
- 12 column grid
- 32px margins
- 24px gutters
- Max content width: 1280px

### Tablet (768px - 1439px)
- 8 column grid
- 24px margins
- 16px gutters

### Mobile (< 768px)
- 4 column grid
- 16px margins
- 16px gutters

## Typography

### Font Stack
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

### Text Styles
All measurements in px, line-height in px:

- **Display**: 48/56, Bold (700)
- **H1**: 36/44, Bold (700)
- **H2**: 30/38, Semibold (600)
- **H3**: 24/32, Semibold (600)
- **H4**: 20/28, Semibold (600)
- **Body Large**: 18/28, Regular (400)
- **Body**: 16/24, Regular (400)
- **Small**: 14/20, Regular (400)
- **Caption**: 12/16, Regular (400)

### Text Colors
- **Primary**: `#1F2937` (Charcoal)
- **Secondary**: `#6B7280` (Gray)
- **Disabled**: `#9CA3AF`
- **Link**: `#10B981` (Green)
- **Link Hover**: `#059669`

## Color System

### Primary Palette
- **Primary**: `#10B981` (Green)
- **Primary Dark**: `#059669`
- **Primary Light**: `#34D399`

### Neutral Palette
- **Gray 900**: `#111827`
- **Gray 800**: `#1F2937`
- **Gray 700**: `#374151`
- **Gray 600**: `#4B5563`
- **Gray 500**: `#6B7280`
- **Gray 400**: `#9CA3AF`
- **Gray 300**: `#D1D5DB`
- **Gray 200**: `#E5E7EB`
- **Gray 100**: `#F3F4F6`
- **Gray 50**: `#F9FAFB`

### Semantic Colors
- **Success**: `#10B981`
- **Warning**: `#F59E0B`
- **Error**: `#EF4444`
- **Info**: `#3B82F6`

### Background Colors
- **Primary**: `#FFFFFF`
- **Secondary**: `#F9FAFB`
- **Tertiary**: `#F3F4F6`

## Spacing

Use a 4px base unit. Common values:
- **4px**: Extra tight (within components)
- **8px**: Tight
- **12px**: Small
- **16px**: Default
- **24px**: Medium
- **32px**: Large
- **48px**: Extra large
- **64px**: Huge

## Components

### Buttons

#### Sizes
- **Large**: Height 48px, padding 16px 32px, font 18px
- **Medium**: Height 44px, padding 12px 24px, font 16px
- **Small**: Height 36px, padding 8px 16px, font 14px

#### Variants
All buttons have 8px border radius.

**Primary**
- Background: `#10B981`
- Text: `#FFFFFF`
- Hover: `#059669`
- Active: `#047857`
- Disabled: `#D1D5DB` bg, `#9CA3AF` text

**Secondary**
- Background: `#FFFFFF`
- Border: 1px solid `#E5E7EB`
- Text: `#1F2937`
- Hover: `#F9FAFB` bg
- Active: `#F3F4F6` bg

**Danger**
- Background: `#EF4444`
- Text: `#FFFFFF`
- Hover: `#DC2626`
- Active: `#B91C1C`

### Form Elements

#### Input Fields
- Height: 44px
- Border: 1px solid `#E5E7EB`
- Border radius: 6px
- Padding: 12px 16px
- Background: `#FFFFFF`
- Font size: 16px
- Placeholder color: `#9CA3AF`

**States:**
- Focus: 2px solid `#10B981`
- Error: 1px solid `#EF4444`
- Disabled: `#F9FAFB` bg

#### Labels
- Font: 14px, medium (500)
- Color: `#1F2937`
- Margin bottom: 6px

#### Help Text
- Font: 14px
- Color: `#6B7280`
- Margin top: 4px

#### Error Messages
- Font: 14px
- Color: `#EF4444`
- Margin top: 4px

### Cards

#### Default Card
- Background: `#FFFFFF`
- Border: 1px solid `#E5E7EB`
- Border radius: 12px
- Padding: 24px
- Shadow: `0 1px 3px rgba(0, 0, 0, 0.1)`

#### Interactive Card
- Same as default plus:
- Hover shadow: `0 4px 6px rgba(0, 0, 0, 0.1)`
- Transition: `box-shadow 0.15s ease`

### Tables

#### Header
- Background: `#F9FAFB`
- Border bottom: 1px solid `#E5E7EB`
- Font: 14px, medium (500)
- Color: `#6B7280`
- Padding: 12px 16px

#### Rows
- Border bottom: 1px solid `#F3F4F6`
- Padding: 16px
- Hover: `#F9FAFB` bg

#### Cells
- Font: 14px
- Color: `#1F2937`
- Vertical align: middle

### Navigation

#### Top Nav
- Height: 64px
- Background: `#FFFFFF`
- Border bottom: 1px solid `#E5E7EB`
- Logo: 32px height
- Menu items: 16px font, `#6B7280` default, `#10B981` active

#### Sidebar
- Width: 280px
- Background: `#F9FAFB`
- Border right: 1px solid `#E5E7EB`
- Item height: 44px
- Item padding: 12px 16px
- Active item: `#10B981` text, `#ECFDF5` bg

### Modals

#### Structure
- Overlay: `rgba(0, 0, 0, 0.5)`
- Background: `#FFFFFF`
- Border radius: 16px
- Padding: 32px
- Max width: 560px
- Shadow: `0 20px 25px rgba(0, 0, 0, 0.15)`

#### Header
- Font: H3 (24px)
- Margin bottom: 16px

#### Footer
- Margin top: 32px
- Buttons right-aligned
- 12px gap between buttons

### Alerts

#### Structure
- Border radius: 8px
- Padding: 16px
- Icon size: 20px
- Gap between icon and text: 12px

#### Variants
**Success**
- Background: `#ECFDF5`
- Border: 1px solid `#10B981`
- Icon/text: `#065F46`

**Warning**
- Background: `#FFFBEB`
- Border: 1px solid `#F59E0B`
- Icon/text: `#92400E`

**Error**
- Background: `#FEF2F2`
- Border: 1px solid `#EF4444`
- Icon/text: `#991B1B`

**Info**
- Background: `#EFF6FF`
- Border: 1px solid `#3B82F6`
- Icon/text: `#1E40AF`

## Icons

### Size System
- **Small**: 16px
- **Medium**: 20px (default)
- **Large**: 24px

### Style
- Stroke width: 1.5px
- Corner radius: 1px (for rounded corners)
- Use outline style, not filled

### Common Icons
Use Heroicons (heroicons.com) or similar:
- Navigation: home, settings, logout
- Actions: plus, edit, trash, download
- Status: check-circle, x-circle, exclamation
- Arrows: chevron-down, arrow-right

## States

### Interactive States
All interactive elements should have:
- **Default**: Base state
- **Hover**: Visual feedback on mouse over
- **Active**: Pressed/clicked state
- **Focus**: Keyboard navigation (2px `#10B981` outline)
- **Disabled**: Grayed out, cursor not-allowed

### Loading States
- Spinner: 20px, `#10B981`, 2px stroke
- Skeleton screens: `#F3F4F6` bg with shimmer
- Progress bars: 8px height, `#E5E7EB` bg, `#10B981` fill

### Empty States
- Illustration or icon: 64-120px
- Heading: H4 (20px)
- Description: Body (16px), `#6B7280`
- Action button if applicable

## Motion

### Transitions
Default timing: `150ms ease-in-out`

Common properties to animate:
- `opacity`
- `transform`
- `box-shadow`
- `background-color`
- `border-color`

### Hover Effects
- Buttons: Darken background
- Cards: Elevate with shadow
- Links: Underline or color change
- Icons: Scale to 110%

### Page Transitions
- Fade in: 200ms
- Slide in: 250ms
- Keep it subtle and functional

## Responsive Behavior

### Breakpoints
```css
/* Mobile */
@media (max-width: 767px) { }

/* Tablet */
@media (min-width: 768px) and (max-width: 1439px) { }

/* Desktop */
@media (min-width: 1440px) { }
```

### Mobile Adaptations
- Stack columns vertically
- Full-width buttons
- Larger touch targets (44px min)
- Simplified navigation
- Hide non-essential elements

### Content Priority
1. Core functionality always visible
2. Secondary features in menus
3. Advanced options hidden by default

## Accessibility

### Minimum Requirements
- Color contrast: 4.5:1 for normal text, 3:1 for large text
- Focus indicators on all interactive elements
- Proper heading hierarchy (don't skip levels)
- Alt text on all informative images
- ARIA labels where needed

### Keyboard Navigation
- Tab through all interactive elements
- Enter/Space to activate buttons
- Escape to close modals
- Arrow keys for menus

### Screen Reader Support
- Semantic HTML elements
- Descriptive link text
- Form labels associated with inputs
- Error messages linked to fields

Remember: A good design system is flexible enough to handle edge cases but rigid enough to maintain consistency.