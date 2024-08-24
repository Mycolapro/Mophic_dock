import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from '@/lib/utils'
import { NextRequest } from 'next/server'
import { getChats } from '@/lib/actions/chat'

const promptSchema = z.object({
  heading: z.string(),
  message: z.string()
})

const responseSchema = z.object({
  prompts: z.array(promptSchema)
})

export async function GET(request: NextRequest) {
  const chats = await getChats('anonymous')

  const titles = chats.map(chat => chat.title).join(', ')
  console.log(titles)

  const { object } = await generateObject({
    model: getModel(),
    schema: responseSchema,
    prompt: `Based on the following set of search queries that have been made in the past: [${titles}], generate a set of three queries that explore the subject matter more deeply, building upon the initial query and the information uncovered in its search results. Aim to create queries that progressively delve into more specific aspects, implications, or adjacent topics related to the initial query. The goal is to anticipate the user's potential information needs and guide them towards a more comprehensive understanding of the subject matter. Please match the language of the response to the user's language.`
  })

  return new Response(JSON.stringify(object), {
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
