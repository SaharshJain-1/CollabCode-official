import React, { useState, useRef, useEffect } from "react";

export interface ChatMessage {
  id: string;
  userName: string;
  text: string;
  timestamp: number;
}

interface RoomChatProps {
  socket: WebSocket | null;
  roomId: string;
  userId: string;
  userName: string;
  messages: ChatMessage[];
}

const RoomChat: React.FC<RoomChatProps> = ({ socket, roomId, userId, userName, messages }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isOpen && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.id !== userId) {
        setUnreadCount((c) => c + 1);
      }
    }
  }, [messages.length]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const sendMessage = () => {
    const trimmed = text.trim();
    if (!trimmed || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(
      JSON.stringify({
        type: "chatMessage",
        roomId,
        userId,
        userName,
        text: trimmed,
        timestamp: Date.now(),
      })
    );
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-20 z-50 bg-green-600 hover:bg-green-700 text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-xl transition-transform duration-200 hover:scale-110"
        title="Room Chat"
      >
        💬
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-16 z-50 w-80 h-[450px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="bg-gray-800 px-4 py-3 flex justify-between items-center border-b border-gray-700">
            <h3 className="text-white font-semibold text-sm">💬 Room Chat</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-white text-lg"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {messages.length === 0 ? (
              <p className="text-gray-500 text-sm text-center mt-8">
                No messages yet. Say hi! 👋
              </p>
            ) : (
              messages.map((msg, idx) => {
                const isMe = msg.id === userId;
                return (
                  <div
                    key={idx}
                    className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                  >
                    <span className="text-[10px] text-gray-500 mb-0.5 px-1">
                      {isMe ? "You" : msg.userName} · {formatTime(msg.timestamp)}
                    </span>
                    <div
                      className={`max-w-[85%] px-3 py-1.5 rounded-xl text-sm break-words ${
                        isMe
                          ? "bg-blue-600 text-white rounded-br-sm"
                          : "bg-gray-700 text-gray-100 rounded-bl-sm"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-3 py-2 border-t border-gray-700 bg-gray-800">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-gray-700 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={sendMessage}
                disabled={!text.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RoomChat;
