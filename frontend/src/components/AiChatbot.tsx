import React, { useState, useRef, useEffect } from "react";
import { API_BASE_URL } from "../Globle";
import { AiOutlineLoading3Quarters } from "react-icons/ai";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AiChatbotProps {
  language: string;
  code: string;
}

const AiChatbot: React.FC<AiChatbotProps> = ({ language, code }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
  const res = await fetch(`${API_BASE_URL}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          language,
        }),
      });

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to reach AI. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const askAboutCode = async () => {
    if (loading) return;
    const userMessage: Message = {
      role: "user",
      content: `Explain this code:\n\`\`\`${language}\n${code}\n\`\`\``,
    };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setLoading(true);

    try {
  const res = await fetch(`${API_BASE_URL}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          language,
        }),
      });

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to reach AI. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```")) {
        const codeContent = part.replace(/```\w*\n?/, "").replace(/```$/, "");
        return (
          <pre
            key={i}
            className="bg-gray-900 text-green-300 p-3 rounded-md my-2 overflow-x-auto text-xs"
          >
            <code>{codeContent.trim()}</code>
          </pre>
        );
      }
      return (
        <span key={i} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    });
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl transition-transform hover:scale-110"
        title="AI Assistant"
      >
        {isOpen ? "✕" : "🤖"}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[70vh] bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3 flex items-center justify-between">
            <span className="text-white font-bold text-lg">🤖 AI Assistant</span>
            <div className="flex gap-2">
              <button
                onClick={askAboutCode}
                className="text-xs bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded-md transition"
                disabled={loading}
              >
                Explain Code
              </button>
              <button
                onClick={() => setMessages([])}
                className="text-xs bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded-md transition"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[45vh]">
            {messages.length === 0 && (
              <div className="text-gray-500 text-sm text-center mt-8">
                <p>👋 Hi! I'm your AI coding assistant.</p>
                <p className="mt-2">Ask me anything about your code, or click <strong>Explain Code</strong> to get an explanation of your current code.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-gray-700 text-gray-200 rounded-bl-sm"
                  }`}
                >
                  {renderContent(msg.content)}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-700 text-gray-300 px-3 py-2 rounded-xl rounded-bl-sm text-sm flex items-center gap-2">
                  <AiOutlineLoading3Quarters className="animate-spin" />
                  Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-gray-700 p-3 flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your code..."
              rows={1}
              className="flex-1 bg-gray-900 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default AiChatbot;
