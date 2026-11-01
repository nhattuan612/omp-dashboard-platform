export function latestUserTurn(value) {
  const prompt = String(value || "").trim();
  const markers = [...prompt.matchAll(/(?:^|\n)\[user\][ \t]*\r?\n/g)];
  if (!markers.length) return prompt;
  const marker = markers[markers.length - 1];
  const tail = prompt.slice(marker.index + marker[0].length);
  const nextMessage = tail.search(/(?:^|\n)\[(?:system|assistant|user|tool)\][ \t]*\r?\n/);
  return (nextMessage < 0 ? tail : tail.slice(0, nextMessage))
    .replace(/\n+\[Dashboard media contract:[\s\S]*$/i, "")
    .trim();
}

export function legacyImageIntent(value) {
  const prompt = latestUserTurn(value);
  if (!prompt) return false;
  return [
    /\b(?:tạo|vẽ|sinh)\s+(?:(?:ra|cho\s+(?:tôi|anh|mình)|giúp\s+(?:tôi|anh|mình))\s+)?(?:(?:một|bức|tấm)\s+)*(?:ảnh(?!\s+hưởng)|hình|logo|poster|tranh|minh hoạ)\b/i,
    /\b(?:generate|create|draw|make|design)\s+(?:(?:me|a|an|one|new)\s+){0,3}(?:image|picture|photo|illustration|logo|poster|png|jpe?g|svg)\b/i,
    /\b(?:biến đổi|transform|redesign|edit)\s+(?:(?:ảnh|hình|image|picture|photo|logo|poster)\b)/i,
  ].some((intent) => intent.test(prompt));
}

export function resolveChatOutputMode(requestedMode, prompt) {
  const mode = requestedMode == null || requestedMode === "" ? "auto" : String(requestedMode).trim().toLowerCase();
  if (mode === "text") return { mode: "text", source: "explicit" };
  if (mode === "image") return { mode: "image", source: "explicit" };
  if (mode === "auto") return { mode: legacyImageIntent(prompt) ? "image" : "text", source: "legacy" };
  throw Object.assign(new Error("outputMode phải là text, image hoặc auto"), { code: "BAD_REQUEST", field: "outputMode" });
}
