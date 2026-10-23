import type { Plugin } from "vite";
export function prepareMatchingRuntime(): Promise<void>;
export function runMatching(command: string, args: unknown): Promise<unknown>;
export function matchingPreviewPlugin(): Plugin;
