import React, { useEffect, useCallback, useRef } from "react";
import { Tldraw, Editor, TLRecord } from "tldraw";
import "tldraw/tldraw.css";

interface Props {
  socket: WebSocket | null;
  roomId: string;
  userId: string;
}

const CollaborativeWhiteboard: React.FC<Props> = ({ socket, roomId, userId }) => {
  const editorRef = useRef<Editor | null>(null);
  const isRemoteUpdate = useRef(false);

  const handleStoreChange = useCallback(
    (event: { changes: any; source: string }) => {

      if (isRemoteUpdate.current) return;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const { changes, source } = event;

      if (source !== "user") return;

      const payload: any = { added: {}, updated: {}, removed: {} };
      let hasChanges = false;

      for (const [id, record] of Object.entries(changes.added)) {
        payload.added[id] = record;
        hasChanges = true;
      }

      for (const [id, pair] of Object.entries(changes.updated)) {
        payload.updated[id] = (pair as [any, any])[1];
        hasChanges = true;
      }

      for (const [id, record] of Object.entries(changes.removed)) {
        payload.removed[id] = record;
        hasChanges = true;
      }

      if (!hasChanges) return;

      socket.send(
        JSON.stringify({
          type: "drawing",
          roomId,
          userId,
          changes: payload,
        })
      );
    },
    [socket, roomId, userId]
  );

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "drawing") return;
        if (!editorRef.current) return;

        const editor = editorRef.current;
        const store = editor.store;

        isRemoteUpdate.current = true;

        try {

          if (data.changes.added) {
            const records = Object.values(data.changes.added) as TLRecord[];
            if (records.length > 0) {
              store.put(records);
            }
          }

          if (data.changes.updated) {
            const records = Object.values(data.changes.updated) as TLRecord[];
            if (records.length > 0) {
              store.put(records);
            }
          }

          if (data.changes.removed) {
            const ids = Object.keys(data.changes.removed) as TLRecord["id"][];
            if (ids.length > 0) {
              store.remove(ids);
            }
          }
        } finally {
          isRemoteUpdate.current = false;
        }
      } catch (err) {

      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      editor.store.listen(handleStoreChange, {
        source: "user",
        scope: "document",
      });

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "requestDrawingState",
            roomId,
            userId,
          })
        );
      }
    },
    [handleStoreChange, socket, roomId, userId]
  );

  useEffect(() => {
    if (!socket) return;

    const handleStateRequest = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "requestDrawingState") return;
        if (!editorRef.current) return;

        const allRecords = editorRef.current.store.allRecords();
        const snapshot: Record<string, TLRecord> = {};
        for (const record of allRecords) {
          snapshot[record.id] = record;
        }

        socket.send(
          JSON.stringify({
            type: "drawingSnapshot",
            roomId,
            targetUserId: data.userId,
            snapshot,
          })
        );
      } catch (err) {

      }
    };

    socket.addEventListener("message", handleStateRequest);
    return () => socket.removeEventListener("message", handleStateRequest);
  }, [socket, roomId]);

  useEffect(() => {
    if (!socket) return;

    const handleSnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== "drawingSnapshot") return;
        if (!editorRef.current) return;

        const records = Object.values(data.snapshot) as TLRecord[];
        if (records.length > 0) {
          isRemoteUpdate.current = true;
          try {
            editorRef.current.store.put(records);
          } finally {
            isRemoteUpdate.current = false;
          }
        }
      } catch (err) {

      }
    };

    socket.addEventListener("message", handleSnapshot);
    return () => socket.removeEventListener("message", handleSnapshot);
  }, [socket]);

  return (
    <div style={{ width: "100%", height: "100%", background: "#1e1e1e" }}>
      <Tldraw
        onMount={handleMount}
        options={{
          maxPages: 1,
        }}
      />
    </div>
  );
};

export default CollaborativeWhiteboard;
