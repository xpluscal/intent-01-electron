# Execution Feature

## Overview
The execution feature allows users to run AI-powered tasks on artifacts with access to read references. Users can start executions, monitor their progress, and interact with them through messages.

## Key Components

### 1. useExecution Hook
Located at `src/hooks/useExecution.ts`, this hook manages:
- Starting new executions
- Monitoring execution status
- Streaming execution logs
- Sending messages to running executions

### 2. CodeArtifactView
Updated with a tabbed interface that shows:
- **Current Tab**: The artifact's preview with ability to start new executions
- **Execution Tabs**: One tab per execution showing status, logs, and message interface

### 3. Agent Configuration
- Agent options defined in `src/lib/agents.ts`
- Currently only Claude is enabled
- Easy to extend with new agents in the future

## How It Works

1. **Starting an Execution**
   - User types a message in the Current tab
   - Execution is created with:
     - The artifact as the mutate item
     - Selected references as read items
     - Auto-generated execution plan with paths

2. **Execution Plan Format**
   ```
   [User Message]
   
   You have access to:
   - Mutate item at: mutate/[artifact-id]
   - Read item at: read/[ref-id-1]
   - Read item at: read/[ref-id-2]
   ...
   ```

3. **Monitoring Execution**
   - Status updates every second
   - Real-time log streaming via Server-Sent Events
   - Visual indicators for execution phase and status

4. **Sending Messages**
   - Only available when execution is running
   - Messages sent to `/message/:executionId` endpoint
   - Enter key sends message (Shift+Enter for new line)

## API Endpoints Used

- `POST /execute` - Start new execution
- `GET /status/:executionId` - Get execution status
- `GET /logs/:executionId` - Stream execution logs (SSE)
- `POST /message/:executionId` - Send message to execution

## Future Enhancements

1. **Execution History**
   - Persist executions across sessions
   - Query historical executions by artifact

2. **Execution Management**
   - Stop/cancel running executions
   - Delete completed executions

3. **Preview Management**
   - Start/stop previews for executions
   - Multiple preview support

4. **File Changes**
   - Show diff view for changes made during execution
   - Approve/reject changes before integration