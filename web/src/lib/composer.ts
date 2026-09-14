/** Enter sends; Shift+Enter breaks the line; a key pressed while an IME is composing belongs
 * to the IME (the prototype's ChatInput, plus the composition guard it lacks). */
export function sendsOnKey({ key, shiftKey, isComposing }: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}
