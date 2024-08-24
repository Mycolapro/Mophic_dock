import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

const fetchExampleMessages = async () => {
  const response = await fetch('/api/topics')
  return response.json().then((data) => data.prompts)
}

export function EmptyScreen({
  submitMessage,
  className
}: {
  submitMessage: (message: string) => void
  className?: string
}) {
  const [exampleMessages, setExampleMessages] = useState<{ message: string; heading: string }[]>([])

  useEffect(() => {
    const loadMessages = async () => {
      const messages = await fetchExampleMessages()
      setExampleMessages(messages)
    }
    loadMessages()
  }, [])

  return (
    <div className={`mx-auto w-full transition-all ${className}`}>
      <div className="bg-background p-2">
        <div className="mt-4 flex flex-col items-start space-y-2 mb-4">
          {exampleMessages.map((message, index) => (
            <Button
              key={index}
              variant="link"
              className="h-auto p-0 text-base"
              name={message.message}
              onClick={async () => {
                submitMessage(message.message)
              }}
            >
              <ArrowRight size={16} className="mr-2 text-muted-foreground" />
              {message.heading}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}