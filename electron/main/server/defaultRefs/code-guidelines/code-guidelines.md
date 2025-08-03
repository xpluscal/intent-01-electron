# Code Guidelines

## How We Write Code

### Keep It Simple
- Write code that a junior developer can understand
- If you need to write a comment to explain what code does, rewrite the code
- Avoid clever one-liners that sacrifice readability
- When in doubt, choose the boring solution

### Naming Things
- Use full words, not abbreviations (`userAccount` not `usrAcct`)
- Boolean variables should ask a question (`isLoading`, `hasError`)
- Functions should be verbs (`fetchUser` not `userData`)
- Be specific (`updateUserEmail` not just `update`)

### Functions
- A function should do one thing
- If you use "and" to describe what it does, split it
- 5-10 lines is ideal, 20 is the max
- If you're passing more than 3 arguments, use an object

### Error Handling
- Always handle errors where they might occur
- Throw errors with descriptive messages
- Log errors with context
- Never leave empty catch blocks

### Code Organization
- Group related code together
- Put the most important functions at the top
- Keep files under 200 lines
- If a file is doing too much, split it

## Daily Practices

### Before You Code
- Understand what you're building and why
- Check if similar code already exists
- Think about edge cases upfront

### While Coding
- Make it work first, then make it clean
- Test as you go, don't wait until the end
- Commit often with clear messages

### After Coding
- Read through your changes before committing
- Run the linter and fix issues
- Update documentation if needed

## What We Avoid

### Bad Patterns
- Global variables
- Deeply nested code (max 3 levels)
- Copy-pasted code
- "Temporary" fixes that become permanent
- Console.logs in production code

### Common Mistakes
- Not validating user input
- Ignoring error cases
- Over-engineering simple problems
- Not considering performance impacts
- Breaking existing functionality

## Quick Checklist

Before submitting code, ask yourself:
- [ ] Would a new team member understand this?
- [ ] Have I handled the error cases?
- [ ] Is there any duplicated code?
- [ ] Are the variable names clear?
- [ ] Did I test the edge cases?

Remember: We're not just writing code for computers, we're writing it for other developers (including future you).