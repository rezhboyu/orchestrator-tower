import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface ToolUseContent {
  toolId: string;
  toolName: string;
  input: unknown;
}

interface ToolResultContent {
  toolUseId: string;
  content: string;
  isError: boolean;
}

interface AgentMessage {
  type: 'text' | 'tool_use' | 'tool_result';
  content: unknown;
}

interface MessageStreamProps {
  messages: AgentMessage[];
}

const MAX_INPUT_SUMMARY_LENGTH = 60;

const truncateInput = (input: unknown): string => {
  const str = JSON.stringify(input);
  if (str.length <= MAX_INPUT_SUMMARY_LENGTH) return str;
  return str.slice(0, MAX_INPUT_SUMMARY_LENGTH - 3) + '...';
};

const TextMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="px-3 py-2 text-gray-200 whitespace-pre-wrap break-words">
    {content}
  </div>
);

const ToolUseCard: React.FC<{ content: ToolUseContent }> = ({ content }) => {
  const { t } = useTranslation();
  const inputSummary = truncateInput(content.input);

  return (
    <div
      className="mx-3 my-2 p-3 bg-blue-900/30 border border-blue-700 rounded-lg"
      data-testid="tool-use-card"
    >
      <div className="flex items-center gap-2 text-blue-400 font-medium">
        <span>{t('agentPanel.toolUse', 'Tool Call')}</span>
        <span className="text-blue-300">{content.toolName}</span>
      </div>
      <div
        className="mt-1 text-sm text-gray-400 font-mono"
        data-testid="tool-input-summary"
      >
        {inputSummary}
      </div>
    </div>
  );
};

const ToolResultCard: React.FC<{ content: ToolResultContent }> = ({ content }) => {
  const { t } = useTranslation();
  const isError = content.isError;

  return (
    <div
      className={`mx-3 my-2 p-3 rounded-lg border ${
        isError
          ? 'bg-red-900/30 border-red-700'
          : 'bg-green-900/30 border-green-700'
      }`}
      data-testid="tool-result-card"
    >
      <div
        className={`flex items-center gap-2 font-medium ${
          isError ? 'text-red-400' : 'text-green-400'
        }`}
      >
        <span>{isError ? '\u2716' : '\u2714'}</span>
        <span>
          {t('agentPanel.toolResult', 'Tool Result')}
          {isError && ` (${t('agentPanel.error', 'Error')})`}
        </span>
      </div>
      <div className="mt-1 text-sm text-gray-400 font-mono max-h-32 overflow-auto">
        {content.content.slice(0, 500)}
        {content.content.length > 500 && '...'}
      </div>
    </div>
  );
};

export const MessageStream: React.FC<MessageStreamProps> = ({ messages }) => {
  const { t } = useTranslation();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {t('agentPanel.noMessages', 'No messages yet')}
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto bg-gray-900"
      data-testid="message-stream"
    >
      {messages.map((message, index) => {
        switch (message.type) {
          case 'text':
            return (
              <TextMessage
                key={`text-${index}`}
                content={message.content as string}
              />
            );
          case 'tool_use':
            return (
              <ToolUseCard
                key={`tool-use-${index}`}
                content={message.content as ToolUseContent}
              />
            );
          case 'tool_result':
            return (
              <ToolResultCard
                key={`tool-result-${index}`}
                content={message.content as ToolResultContent}
              />
            );
          default:
            return null;
        }
      })}
      <div ref={messagesEndRef} />
    </div>
  );
};

// Export for testing
export { truncateInput };
