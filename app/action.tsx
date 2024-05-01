import {
  StreamableValue,
  createAI,
  createStreamableUI,
  createStreamableValue,
  getAIState,
  getMutableAIState
} from 'ai/rsc'
import { ExperimentalMessage, nanoid, ToolResultPart } from 'ai'
import { Spinner } from '@/components/ui/spinner'
import { Section } from '@/components/section'
import { FollowupPanel } from '@/components/followup-panel'
import { inquire, researcher, taskManager, querySuggestor } from '@/lib/agents'
import { writer } from '@/lib/agents/writer'
import { saveChat } from '@/lib/actions/chat'
import { Chat } from '@/lib/types'
import { AIMessage } from '@/lib/types'
import { UserMessage } from '@/components/user-message'
import { BotMessage } from '@/components/message'
import { SearchSection } from '@/components/search-section'
import SearchRelated from '@/components/search-related'
import { Copilot } from '@/components/copilot'

async function submit(formData?: FormData, skip?: boolean) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()
  const uiStream = createStreamableUI()
  const isGenerating = createStreamableValue(true)
  const isCollapsed = createStreamableValue(false)
  // Get the messages from the state, filter out the tool messages
  const messages: ExperimentalMessage[] = [
    ...(aiState.get().messages as any[])
  ].filter(message => message.role !== 'tool')

  console.log('submit', aiState.get())

  const useSpecificAPI = process.env.USE_SPECIFIC_API_FOR_WRITER === 'true'
  const maxMessages = useSpecificAPI ? 5 : 10
  // Limit the number of messages to the maximum
  messages.splice(0, Math.max(messages.length - maxMessages, 0))
  // Get the user input from the form data
  const userInput = skip
    ? `{"action": "skip"}`
    : (formData?.get('input') as string)

  const content = skip
    ? userInput
    : formData
    ? JSON.stringify(Object.fromEntries(formData))
    : null
  const type = skip
    ? undefined
    : formData?.has('input')
    ? 'input'
    : formData?.has('related_query')
    ? 'input_related'
    : 'inquiry'

  console.log('content', content)

  // Add the user message to the state
  if (content) {
    aiState.update({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: nanoid(),
          role: 'user',
          content,
          type
        }
      ]
    })
    messages.push({
      role: 'user',
      content
    })
  }

  async function processEvents() {
    let action: any = { object: { next: 'proceed' } }
    // If the user skips the task, we proceed to the search
    if (!skip) action = (await taskManager(messages)) ?? action

    if (action.object.next === 'inquire') {
      // Generate inquiry
      const inquiry = await inquire(uiStream, messages)
      uiStream.done()
      isGenerating.done()
      isCollapsed.done(false)
      aiState.update({
        ...aiState.get(),
        messages: [
          ...aiState.get().messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: `inquiry: ${inquiry?.question}`
          }
        ]
      })
      return
    }

    // Set the collapsed state to true
    isCollapsed.done(true)

    //  Generate the answer
    let answer = ''
    let toolOutputs: ToolResultPart[] = []
    let errorOccurred = false
    const streamText = createStreamableValue<string>()
    uiStream.update(<Spinner />)

    // If useSpecificAPI is enabled, only function calls will be made
    // If not using a tool, this model generates the answer
    while (
      useSpecificAPI
        ? toolOutputs.length === 0 && answer.length === 0
        : answer.length === 0
    ) {
      // Search the web and generate the answer
      const { fullResponse, hasError, toolResponses } = await researcher(
        uiStream,
        streamText,
        messages,
        useSpecificAPI
      )
      answer = fullResponse
      toolOutputs = toolResponses
      errorOccurred = hasError

      if (toolOutputs.length > 0) {
        toolOutputs.map(output => {
          aiState.update({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: nanoid(),
                role: 'tool',
                content: JSON.stringify(output.result),
                name: output.toolName,
                type: 'tool'
              }
            ]
          })
        })
      }
    }

    // If useSpecificAPI is enabled, generate the answer using the specific model
    if (useSpecificAPI && answer.length === 0) {
      // modify the messages to be used by the specific model
      const modifiedMessages = aiState.get().messages.map(msg =>
        msg.role === 'tool'
          ? {
              ...msg,
              role: 'assistant',
              content: JSON.stringify(msg.content),
              type: 'tool'
            }
          : msg
      ) as ExperimentalMessage[]
      answer = await writer(uiStream, streamText, modifiedMessages)
    } else {
      streamText.done()
    }

    aiState.update({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: nanoid(),
          role: 'assistant',
          content: answer,
          type: 'answer'
        }
      ]
    })

    if (!errorOccurred) {
      // Generate related queries
      const relatedQueries = await querySuggestor(uiStream, messages)
      aiState.update({
        ...aiState.get(),
        messages: [
          ...aiState.get().messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: JSON.stringify(relatedQueries),
            type: 'related'
          }
        ]
      })

      // Add follow-up panel
      uiStream.append(
        <Section title="Follow-up">
          <FollowupPanel />
        </Section>
      )
    }

    isGenerating.done(false)
    uiStream.done()
    aiState.done(aiState.get())

    console.log('aiState', aiState.get().chatId)
  }

  processEvents()

  return {
    id: nanoid(),
    isGenerating: isGenerating.value,
    component: uiStream.value,
    isCollapsed: isCollapsed.value
  }
}

export type AIState = {
  messages: AIMessage[]
  chatId: string
}

export type UIState = {
  id: string
  component: React.ReactNode
  isGenerating?: StreamableValue<boolean>
  isCollapsed?: StreamableValue<boolean>
}[]

const initialAIState: AIState = {
  chatId: nanoid(),
  messages: []
}

const initialUIState: UIState = []

// AI is a provider you wrap your application with so you can access AI and UI state in your components.
export const AI = createAI<AIState, UIState>({
  actions: {
    submit
  },
  initialUIState,
  initialAIState,
  unstable_onGetUIState: async () => {
    'use server'

    const aiState = getAIState()
    if (aiState) {
      const uiState = getUIStateFromAIState(aiState)
      return uiState
    } else {
      return
    }
  },
  unstable_onSetAIState: async ({ state, done }) => {
    'use server'

    const { chatId, messages } = state
    const createdAt = new Date()
    const userId = 'anonymous'
    const path = `/search/${chatId}`
    const title =
      JSON.parse(messages[0].content)?.input?.substring(0, 100) || 'Untitled'
    const chat: Chat = { id: chatId, createdAt, userId, path, title, messages }
    await saveChat(chat)
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  const groupedId = nanoid()
  return aiState.messages.map(message => {
    const { role, content, id, type, name } = message

    if (!type)
      return {
        id,
        component: null
      }

    switch (role) {
      case 'user':
        switch (type) {
          case 'input' || 'input_related':
            const json = JSON.parse(content)
            const value = type === 'input' ? json.input : json.related_query
            return {
              id,
              component: (
                <Section>
                  <UserMessage message={value} />
                </Section>
              )
            }
          case 'inquiry':
            const inquiry = createStreamableValue()
            inquiry.done(content)
            return {
              id,
              component: (
                <Section>
                  <Copilot inquiry={inquiry.value} initialCompleted={true} />
                </Section>
              )
            }
        }
      case 'assistant':
        const answer = createStreamableValue()
        answer.done(content)
        switch (type) {
          case 'answer':
            return {
              id: groupedId,
              component: (
                <Section title="Answer">
                  <BotMessage content={answer.value} />
                </Section>
              )
            }
          case 'related':
            const relatedQueries = createStreamableValue()
            relatedQueries.done(JSON.parse(content))
            return {
              id: groupedId,
              component: (
                <Section title="Related" separator={true}>
                  <SearchRelated relatedQueries={relatedQueries.value} />
                </Section>
              )
            }
        }
      case 'tool':
        const toolOutput = JSON.parse(content)
        const isCollapsed = createStreamableValue()
        isCollapsed.done(true)
        const searchResults = createStreamableValue()
        searchResults.done(JSON.stringify(toolOutput))
        switch (name) {
          case 'search':
            return {
              id: groupedId,
              component: <SearchSection result={searchResults.value} />,
              isCollapsed: isCollapsed.value
            }
        }
      default:
        return {
          id,
          component: null
        }
    }
  })
}
