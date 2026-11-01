import assert from "node:assert/strict";
import test from "node:test";
import { resolveChatOutputMode } from "../chat-output-mode.mjs";

const fristcarePrompt = "Rà soát UX cho trang tạo bài Blog. Cần xem cả Thư viện ảnh, ảnh đại diện và phần nội dung.";

test("does not infer image output from unrelated create and image terms in a text task", () => {
  assert.deepEqual(resolveChatOutputMode(undefined, fristcarePrompt), { mode: "text", source: "legacy" });
});

test("does not treat the Vietnamese phrase ảnh hưởng as image generation", () => {
  assert.deepEqual(resolveChatOutputMode(undefined, "Tạo ảnh hưởng tích cực cho dự án."), { mode: "text", source: "legacy" });
});

test("keeps clear legacy image prompts working", () => {
  assert.deepEqual(resolveChatOutputMode("auto", "Tạo một ảnh phong cảnh."), { mode: "image", source: "legacy" });
});

test("explicit text overrides image wording in the prompt", () => {
  assert.deepEqual(resolveChatOutputMode("text", "Tạo một poster màu xanh."), { mode: "text", source: "explicit" });
});

test("explicit image mode works without relying on prompt wording", () => {
  assert.deepEqual(resolveChatOutputMode("image", "Làm theo yêu cầu."), { mode: "image", source: "explicit" });
});

test("resolves each request independently and rejects invalid modes", () => {
  assert.equal(resolveChatOutputMode("image", "x").mode, "image");
  assert.equal(resolveChatOutputMode("text", "Tạo poster").mode, "text");
  assert.throws(() => resolveChatOutputMode("video", "x"), { code: "BAD_REQUEST", field: "outputMode" });
});
