import React, { useState, useEffect, useRef } from "react";
import MonacoEditor from '@monaco-editor/react';
import { userAtom } from "../atoms/userAtom";
import { useRecoilState } from "recoil";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import { socketAtom } from "../atoms/socketAtom";
import { connectedUsersAtom } from "../atoms/connectedUsersAtom";
import { API_BASE_URL } from "../Globle";
import AiChatbot from "../components/AiChatbot";
import CollaborativeWhiteboard from "../components/CollaborativeWhiteboard";
import RoomChat, { ChatMessage } from "../components/RoomChat";
import axios from "axios";

const CodeEditor: React.FC = () => {
  const [code, setCode] = useState<string>("// Write your code here...");
  const [language, setLanguage] = useState("javascript");
  const [output, setOutput] = useState<string[]>([]);
  const [socket] = useRecoilState<WebSocket | null>(socketAtom);
  const [isLoading, setIsLoading] = useState(false);
  const [currentButtonState, setCurrentButtonState] = useState("Submit Code");
  const [input, setInput] = useState<string>("");
  const [user] = useRecoilState(userAtom);
  const [activeView, setActiveView] = useState<"editor" | "whiteboard">("editor");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [connectedUsers, setConnectedUsers] = useRecoilState(connectedUsersAtom);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const codeRef = useRef(code);
  const inputRef = useRef(input);
  const languageRef = useRef(language);
  const currentButtonStateRef = useRef(currentButtonState);
  const isLoadingRef = useRef(isLoading);
  const remoteCursorsRef = useRef<{ [userId: string]: string[] }>({});

  useEffect(() => { codeRef.current = code; }, [code]);
  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { currentButtonStateRef.current = currentButtonState; }, [currentButtonState]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch (_) { return; }

      if (data.type === "output") {
        setOutput([data.message]);
        setCurrentButtonState("Submit Code");
        setIsLoading(false);
      }

      if (data.type === "clearOutput") {
        setOutput([]);
      }

      if (data.type === "users") {
        setConnectedUsers(data.users);
      }

      if (data.type === "code") {
        setCode(data.code);
      }

      if (data.type === "input") {
        setInput(data.input);
      }

      if (data.type === "language") {
        setLanguage(data.language);
      }

      if (data.type === "submitBtnStatus") {
        setCurrentButtonState(data.value);
        setIsLoading(data.isLoading);
      }

      if (data.type === "cursorPosition") {
        const { userId, userName, cursorPosition } = data;

        if (!editorRef.current) return;

        const oldDecorations = remoteCursorsRef.current[userId] || [];

        const newDecoration = {
          range: {
            startLineNumber: cursorPosition.lineNumber,
            startColumn: cursorPosition.column,
            endLineNumber: cursorPosition.lineNumber,
            endColumn: cursorPosition.column,
          },
          options: {
            className: "remote-cursor",
            hoverMessage: { value: `**${userName || userId}**` },
          },
        };

        const newDecorationIds = editorRef.current.deltaDecorations(
          oldDecorations,
          [newDecoration]
        );

        remoteCursorsRef.current[userId] = newDecorationIds;
      }

      if (data.type === "requestForAllData") {
        socket.send(JSON.stringify({
          type: "allData",
          code: codeRef.current,
          input: inputRef.current,
          language: languageRef.current,
          currentButtonState: currentButtonStateRef.current,
          isLoading: isLoadingRef.current,
          userId: data.userId,
        }));
      }

      if (data.type === "allData") {
        setCode(data.code);
        setInput(data.input);
        setLanguage(data.language);
        setCurrentButtonState(data.currentButtonState);
        setIsLoading(data.isLoading);
      }

      if (data.type === "chatMessage") {
        setChatMessages((prev) => [
          ...prev,
          { id: data.userId, userName: data.userName, text: data.text, timestamp: data.timestamp },
        ]);
      }
    };

    socket.addEventListener("message", handleMessage);

    socket.send(JSON.stringify({ type: "requestToGetUsers", roomId: user.roomId }));
    socket.send(JSON.stringify({ type: "requestForAllData", roomId: user.roomId }));

    return () => {
      socket.removeEventListener("message", handleMessage);
    };

  }, [socket]);

  const handleSubmit = async () => {
    if (isLoading) return;

    setOutput([]);
    handleButtonStatus("Compiling...", true);
    socket?.send(JSON.stringify({ type: "clearOutput", roomId: user.roomId }));

    try {
      const res = await axios.post(`${API_BASE_URL}/submit`, {
        code,
        language,
        roomId: user.roomId,
        input,
      }, { headers: { "Content-Type": "application/json" } });

      if (res.status !== 200) {
        setOutput(["Error: Submission was not accepted by the server."]);
        handleButtonStatus("Submit Code", false);
      }
    } catch (error) {
      console.error("Failed to submit code:", error);
      setOutput(["Error: Could not connect to the submission service."]);
      handleButtonStatus("Submit Code", false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    socket?.send(JSON.stringify({ type: "input", input: e.target.value, roomId: user.roomId }));
  };

  const handleLanguageChange = (value: string) => {
    setLanguage(value);
    socket?.send(JSON.stringify({ type: "language", language: value, roomId: user.roomId }));
  };

  const handleButtonStatus = (value: string, loading: boolean) => {
    setCurrentButtonState(value);
    setIsLoading(loading);
    socket?.send(JSON.stringify({ type: "submitBtnStatus", value, isLoading: loading, roomId: user.roomId }));
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    if (editor) {
      editor.onDidChangeModelContent(() => {
        console.log("Code Updated:", editor.getValue());
        setCode(editor.getValue());
        socket?.send(JSON.stringify({ type: "code", code: editor.getValue(), roomId: user.roomId }));
      });

      let ghostDecoration: string[] = [];
      let pendingSuggestion: string | null = null;
      let pendingPosition: any = null;
      let fetchController: AbortController | null = null;
      let isFetching = false;

      const clearGhost = () => {
        ghostDecoration = editor.deltaDecorations(ghostDecoration, []);
        pendingSuggestion = null;
        pendingPosition = null;
      };

      const acceptGhost = () => {
        if (!pendingSuggestion || !pendingPosition) return false;
        const text = pendingSuggestion;
        clearGhost();
        editor.executeEdits("ai-autocomplete", [{
          range: new monaco.Range(pendingPosition.lineNumber, pendingPosition.column, pendingPosition.lineNumber, pendingPosition.column),
          text,
        }]);
        return true;
      };

      editor.onKeyDown((e: any) => {
        if (pendingSuggestion) {
          if (e.keyCode === monaco.KeyCode.Tab) {
            e.preventDefault();
            e.stopPropagation();
            acceptGhost();
          } else if (e.keyCode === monaco.KeyCode.Escape) {
            e.preventDefault();
            clearGhost();
          } else {
            clearGhost();
          }
        }
      });

      const triggerAutocomplete = async () => {
        if (isFetching) return;
        clearGhost();

        const pos = editor.getPosition();
        if (!pos) return;
        const model = editor.getModel();
        if (!model) return;

        const fullText = model.getValue();
        const offset = model.getOffsetAt(pos);
        const codeBeforeCursor = fullText.substring(0, offset);
        const codeAfterCursor = fullText.substring(offset);

        if (codeBeforeCursor.trim().length < 3) return;

        const currentLang = model.getLanguageId?.() || "javascript";

        isFetching = true;
        pendingPosition = { lineNumber: pos.lineNumber, column: pos.column };
        ghostDecoration = editor.deltaDecorations(ghostDecoration, [{
          range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column + 1),
          options: { after: { content: "  💡 thinking...", inlineClassName: "ai-ghost-text" } },
        }]);

        if (fetchController) fetchController.abort();
        fetchController = new AbortController();

        try {
          const res = await fetch(`${API_BASE_URL}/ai/autocomplete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              codeBeforeCursor: codeBeforeCursor.slice(-1500),
              codeAfterCursor: codeAfterCursor.slice(0, 500),
              language: currentLang,
            }),
            signal: fetchController.signal,
          });

          if (!res.ok) { clearGhost(); isFetching = false; return; }

          const data = await res.json();
          const suggestion = data.suggestion?.trim();

          if (!suggestion || suggestion === "NONE") { clearGhost(); isFetching = false; return; }

          const currentPos = editor.getPosition();
          if (!currentPos || currentPos.lineNumber !== pos.lineNumber || currentPos.column !== pos.column) {
            clearGhost(); isFetching = false; return;
          }

          pendingSuggestion = suggestion;
          pendingPosition = { lineNumber: pos.lineNumber, column: pos.column };

          const lines = suggestion.split("\n");
          const decorations: any[] = [];

          decorations.push({
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            options: { after: { content: lines[0], inlineClassName: "ai-ghost-text" } },
          });

          for (let i = 1; i < lines.length && i < 5; i++) {
            const ln = pos.lineNumber + i;
            if (ln <= model.getLineCount()) {
              decorations.push({
                range: new monaco.Range(ln, 1, ln, 1),
                options: { before: { content: lines[i] || " ", inlineClassName: "ai-ghost-text" } },
              });
            }
          }

          if (lines.length > 5) {
            decorations[0].options.after.content += `  …(+${lines.length - 5} more lines)`;
          }

          ghostDecoration = editor.deltaDecorations(ghostDecoration, decorations);
        } catch (err: any) {
          clearGhost();
          if (err.name !== "AbortError") console.error("[AI Autocomplete] Error:", err);
        } finally {
          isFetching = false;
        }
      };

      editor.addAction({
        id: "ai-trigger-autocomplete",
        label: "AI Autocomplete (Ctrl+I)",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        run: triggerAutocomplete,
      });

      editor.addAction({
        id: "ai-trigger-autocomplete-alt",
        label: "AI Autocomplete (Alt)",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyA],
        run: triggerAutocomplete,
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white px-4 pt-4">
      <style>{`
        .ai-ghost-text {
          color: #6b7280 !important;
          font-style: italic;
          opacity: 0.6;
        }
      `}</style>
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row space-y-4 lg:space-y-0 lg:space-x-4">

          <div className="w-full lg:w-3/4">
            <div className="flex justify-between mb-4 lg:px-3">
              <label className="text-white text-2xl lg:text-3xl">CollabCode</label>
              <div className="flex gap-3 items-center">
                <div className="flex bg-gray-800 rounded-lg overflow-hidden shadow-lg">
                  <button
                    onClick={() => setActiveView("editor")}
                    className={`px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                      activeView === "editor" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    📝 Code
                  </button>
                  <button
                    onClick={() => setActiveView("whiteboard")}
                    className={`px-3 py-2 text-sm font-medium transition-colors duration-200 ${
                      activeView === "whiteboard" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    🎨 Whiteboard
                  </button>
                </div>

                {activeView === "editor" && (
                  <div className="flex justify-center">
                    <button
                      onClick={handleSubmit}
                      className={`bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-3 lg:px-4 py-2 rounded-lg shadow-lg transition-transform duration-300 transform ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                      disabled={isLoading}
                    >
                      <span className="flex items-center space-x-2">
                        {isLoading && <AiOutlineLoading3Quarters className="animate-spin" />}
                        <span>{currentButtonState}</span>
                      </span>
                    </button>
                  </div>
                )}

                {activeView === "editor" && (
                  <select
                    value={language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="bg-gray-800 h-10 text-white px-3 lg:px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-lg transition duration-300"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                    <option value="cpp">C++</option>
                    <option value="java">Java</option>
                    <option value="rust">Rust</option>
                    <option value="go">Go</option>
                  </select>
                )}
              </div>
            </div>

            {activeView === "editor" ? (
              <div className="border border-gray-700 rounded-lg overflow-hidden shadow-lg">
                <MonacoEditor
                  value={code}
                  language={language}
                  theme="vs-dark"
                  className="lg:h-[90vh] h-[60vh]"
                  onMount={handleEditorDidMount}
                />
              </div>
            ) : (
              <div className="border border-gray-700 rounded-lg overflow-hidden shadow-lg lg:h-[90vh] h-[60vh]">
                <CollaborativeWhiteboard
                  socket={socket}
                  roomId={user.roomId}
                  userId={user.id || "anonymous"}
                />
              </div>
            )}
          </div>

          <div className="w-full lg:w-1/4 flex flex-col space-y-4">
            <div className="flex flex-col lg:flex-row justify-between space-y-4 lg:space-y-0 lg:space-x-4">
              <div className="w-full lg:w-1/2">
                <h2 className="text-lg lg:text-xl font-bold text-gray-400">Users:</h2>
                <div className="bg-gray-800 text-green-400 p-4 rounded-lg mt-2 overflow-y-auto shadow-lg max-h-40 lg:max-h-60">
                  {connectedUsers.length > 0 ? (
                    connectedUsers.map((u: any, index: number) => (
                      <div key={index} className="flex items-center space-x-2">
                        <div className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <pre className="whitespace-pre-wrap text-sm lg:text-base">{u.name}</pre>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500">No user connected yet.</p>
                  )}
                </div>
              </div>

              <div className="w-full lg:w-1/2 flex flex-col space-y-4">

                <div>
                  <h2 className="text-lg lg:text-xl font-bold text-gray-400">Invitation Code:</h2>
                  <div className="bg-gray-800 text-green-400 p-4 rounded-lg mt-2 overflow-y-auto shadow-lg max-h-40 lg:max-h-60">
                    {user.roomId.length > 0 ? (
                      <pre className="whitespace-pre-wrap text-sm lg:text-base">{user.roomId}</pre>
                    ) : (
                      <p className="text-gray-500">No invitation code yet.</p>
                    )}
                  </div>
                </div>

                <div>
                  <h2 className="text-lg lg:text-xl font-bold text-gray-400">Joined As:</h2>
                  <div className="bg-gray-800 text-blue-300 p-4 rounded-lg mt-2 shadow-lg flex items-center space-x-3">
                    <div className="bg-blue-600 text-white rounded-full w-8 h-8 flex shrink-0 items-center justify-center font-bold">
                      {user.name ? user.name.charAt(0).toUpperCase() : "?"}
                    </div>
                    <span className="whitespace-pre-wrap text-sm lg:text-base font-semibold truncate">
                      {user.name || "Anonymous"}
                    </span>
                  </div>
                </div>

              </div>
            </div>

            <div>
              <h2 className="text-lg lg:text-xl font-bold text-gray-400">Input:</h2>
              <textarea
                value={input}
                style={{ height: "120px" }}
                onChange={handleInputChange}
                placeholder={`Enter input for your code like... \n5 \n10`}
                className="bg-gray-800 text-white w-full p-4 rounded-lg shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2 text-sm lg:text-base"
              />
            </div>

            <div className="flex-1 pb-8">
              <div className="flex justify-between px-2">
                <h2 className="text-lg lg:text-xl font-bold text-gray-400">Output:</h2>
                <button onClick={() => setOutput([])} className="text-red-500 hover:text-red-600">
                  Clear
                </button>
              </div>
              <div className="bg-gray-800 text-green-400 p-4 max-h-[60vh] rounded-lg mt-2 h-full overflow-y-auto shadow-lg space-y-2 text-sm lg:text-base">
                {output.length > 0 ? (
                  output.map((line, index) => (
                    <pre key={index} className="whitespace-pre-wrap">{line}</pre>
                  ))
                ) : (
                  <p className="text-gray-500">No output yet. Submit your code to see results.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AiChatbot language={language} code={code} />

      <RoomChat
        socket={socket}
        roomId={user.roomId}
        userId={user.id || "anonymous"}
        userName={user.name || "Anonymous"}
        messages={chatMessages}
      />
    </div>
  );
};

export default CodeEditor;
