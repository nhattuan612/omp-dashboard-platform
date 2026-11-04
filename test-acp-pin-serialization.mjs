#!/usr/bin/env node
import assert from "node:assert/strict";
import { AcpWorker } from "./acp-worker.mjs";

const worker = new AcpWorker({ command: "unused", args: [], cwd: process.cwd() });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let activePins = 0;
let maxActivePins = 0;
let normalPromptStarted = false;

const pin = () => worker.runPinOperation(async () => {
  activePins += 1;
  maxActivePins = Math.max(maxActivePins, activePins);
  await wait(20);
  activePins -= 1;
});

const firstPin = pin();
const secondPin = pin();
worker.request = async () => {
  normalPromptStarted = true;
  await wait(5);
};
await Promise.all([firstPin, secondPin, worker.request("session/prompt")]);

await assert.rejects(worker.runPinOperation(() => Promise.reject(new Error("expected"))), /expected/);
await worker.runPinOperation(async () => {});

assert.equal(maxActivePins, 1, "pin-sensitive operations on a shared worker must run serially");
assert.equal(normalPromptStarted, true, "ordinary prompt work must not wait on the pin queue");
assert.equal(worker.pinOperationQueue instanceof Promise, true, "a rejected pin operation must not poison the queue");
process.stdout.write("ACP pin serialization: pin operations serialize; ordinary work remains independent\n");
