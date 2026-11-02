import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Tooltip } from '@mantine/core';
import { useUi } from './controls.js';

interface CanvasTargetProps {
  canvas: HTMLCanvasElement;
  instruction: string | null;
  onMouseEnter?: (event: MouseEvent) => void;
  onMouseLeave?: (event: MouseEvent) => void;
}

/** Adapts Mantine's target to Blazor-owned DOM; Mantine still owns pointer tracking and positioning. */
const CanvasTarget = forwardRef<HTMLCanvasElement, CanvasTargetProps>(function CanvasTarget({canvas,instruction,onMouseEnter,onMouseLeave},ref) {
  const callbacks=useRef({onMouseEnter,onMouseLeave}),lastMove=useRef<MouseEvent|null>(null),hovered=useRef(canvas.matches(':hover'));
  callbacks.current={onMouseEnter,onMouseLeave};
  useImperativeHandle(ref,()=>canvas,[canvas]);
  useEffect(()=>{
    const enter=(event:MouseEvent)=>{hovered.current=true;lastMove.current=event;callbacks.current.onMouseEnter?.(event);};
    const leave=(event:MouseEvent)=>{hovered.current=false;callbacks.current.onMouseLeave?.(event);};
    const move=(event:MouseEvent)=>{lastMove.current=event;};
    // Native capture preserves drawing ownership outside the canvas, but tooltip visibility follows the physical hit target.
    const capturedMove=(event:PointerEvent)=>{
      if(!canvas.hasPointerCapture(event.pointerId))return;
      const inside=canvas.ownerDocument.elementFromPoint(event.clientX,event.clientY)===canvas;
      if(inside&&!hovered.current)enter(event);
      else if(!inside&&hovered.current)leave(event);
    };
    canvas.addEventListener('mouseenter',enter);canvas.addEventListener('mouseleave',leave);
    canvas.addEventListener('mousemove',move);canvas.addEventListener('pointermove',capturedMove);
    return()=>{
      canvas.removeEventListener('mouseenter',enter);canvas.removeEventListener('mouseleave',leave);
      canvas.removeEventListener('mousemove',move);canvas.removeEventListener('pointermove',capturedMove);
    };
  },[canvas]);
  useEffect(()=>{
    // Floating does not remeasure when a hidden label appears or grows. Refresh its native virtual reference
    // with the last real input, without dispatching another drawing event or recalculating coordinates.
    if(instruction&&hovered.current&&lastMove.current)callbacks.current.onMouseEnter?.(lastMove.current);
  },[instruction]);
  return null;
});

/** Observes native instructions even during busy drawing gestures; no UI pointer counter duplicates the tool machine. */
export function CreationTooltip({container}: {container:HTMLElement}) {
  const {state,ui}=useUi(),canvas=container.querySelector<HTMLCanvasElement>('.drawmotive-canvas-host canvas');
  if(!canvas)return null;
  const instruction=ui.tooltip.visible&&state.editingEnabled&&state.health==='healthy'?state.prompt??null:null;
  return <Tooltip.Floating label={instruction??''} disabled={!instruction}
    defaultOpened={canvas.matches(':hover')} withinPortal={false} offset={18} zIndex={100} role="tooltip" aria-live="polite" data-testid="creation-tooltip">
    <CanvasTarget canvas={canvas} instruction={instruction}/>
  </Tooltip.Floating>;
}
