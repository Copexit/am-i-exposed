import { useRef, useState, useCallback, useEffect } from "react";
import type { LayoutNode, ViewTransform } from "./types";

interface UseNodeDraggingParams {
  onNodePositionChange?: (txid: string, x: number, y: number) => void;
  viewTransform?: ViewTransform;
  annotateMode?: boolean;
}

interface UseNodeDraggingReturn {
  draggingTxid: string | null;
  handleNodeMouseDown: (e: React.MouseEvent, node: LayoutNode) => void;
  handleNodeTouchStart: (e: React.TouchEvent, node: LayoutNode) => void;
  justDraggedRef: React.RefObject<boolean>;
}

export function useNodeDragging({
  onNodePositionChange,
  viewTransform,
  annotateMode,
}: UseNodeDraggingParams): UseNodeDraggingReturn {
  const nodeDragRef = useRef<{
    txid: string;
    startMouseX: number;
    startMouseY: number;
    startNodeX: number;
    startNodeY: number;
    isDragging: boolean;
  } | null>(null);
  const [draggingTxid, setDraggingTxid] = useState<string | null>(null);
  const justDraggedRef = useRef(false);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, node: LayoutNode) => {
    if (!onNodePositionChange || !viewTransform || annotateMode) return;
    if (e.button !== 0) return; // left click only
    e.stopPropagation();
    nodeDragRef.current = {
      txid: node.txid,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      isDragging: false,
    };
  }, [onNodePositionChange, viewTransform, annotateMode]);

  // Touch support: long-press initiates drag on mobile
  const handleNodeTouchStart = useCallback((e: React.TouchEvent, node: LayoutNode) => {
    if (!onNodePositionChange || !viewTransform || annotateMode) return;
    if (e.touches.length !== 1) return; // single finger only
    const touch = e.touches[0];
    nodeDragRef.current = {
      txid: node.txid,
      startMouseX: touch.clientX,
      startMouseY: touch.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      isDragging: false,
    };
  }, [onNodePositionChange, viewTransform, annotateMode]);

  // Keep a ref to the latest viewTransform so drag handlers always use current scale
  const viewTransformRef = useRef(viewTransform);
  useEffect(() => { viewTransformRef.current = viewTransform; }, [viewTransform]);

  useEffect(() => {
    if (!onNodePositionChange || !viewTransform) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = nodeDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startMouseX;
      const dy = e.clientY - drag.startMouseY;
      if (!drag.isDragging && Math.sqrt(dx * dx + dy * dy) < 5) return;
      drag.isDragging = true;
      setDraggingTxid(drag.txid);
      const s = viewTransformRef.current?.scale ?? 1;
      const newX = drag.startNodeX + dx / s;
      const newY = drag.startNodeY + dy / s;
      onNodePositionChange(drag.txid, newX, newY);
    };

    const handleMouseUp = () => {
      const drag = nodeDragRef.current;
      if (!drag) return;
      if (drag.isDragging) {
        // Suppress the click that fires right after mouseup
        justDraggedRef.current = true;
        requestAnimationFrame(() => { justDraggedRef.current = false; });
      }
      nodeDragRef.current = null;
      setDraggingTxid(null);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const drag = nodeDragRef.current;
      if (!drag || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - drag.startMouseX;
      const dy = touch.clientY - drag.startMouseY;
      if (!drag.isDragging && Math.sqrt(dx * dx + dy * dy) < 8) return;
      drag.isDragging = true;
      // Prevent scroll while dragging a node
      e.preventDefault();
      setDraggingTxid(drag.txid);
      const s = viewTransformRef.current?.scale ?? 1;
      const newX = drag.startNodeX + dx / s;
      const newY = drag.startNodeY + dy / s;
      onNodePositionChange(drag.txid, newX, newY);
    };

    const handleTouchEnd = () => {
      const drag = nodeDragRef.current;
      if (!drag) return;
      if (drag.isDragging) {
        justDraggedRef.current = true;
        requestAnimationFrame(() => { justDraggedRef.current = false; });
      }
      nodeDragRef.current = null;
      setDraggingTxid(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [onNodePositionChange, viewTransform]);

  return { draggingTxid, handleNodeMouseDown, handleNodeTouchStart, justDraggedRef };
}
