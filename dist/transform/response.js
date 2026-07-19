/**
 * Antigravity Gemini format → OpenAI-compatible response transformer.
 *
 * Transforms:
 * - candidates[] → choices[]
 * - parts[{text}] → delta.content
 * - parts[{thought}] → delta.reasoning_content
 * - functionCall → tool_calls (with FIFO ID matching)
 * - usageMetadata → usage
 * - SSE streaming: rewrites each SSE line in real-time
 *
 * Phase 4: Improved FIFO tool call ID matching, edge case handling.
 */
function createSSEState() {
    return {
        toolCallIndex: 0,
        toolCallNames: [],
    };
}
// Module-level state (reset per request)
let currentState = createSSEState();
/** Reset the SSE state for a new request. */
export function resetSSEState() {
    currentState = createSSEState();
}
// ---- Response Builders ----
let globalChunkCounter = 0;
function nextGlobalChunkId() {
    return `chatcmpl-${++globalChunkCounter}`;
}
/**
 * Generate a deterministic tool call ID from the function name and index.
 * This ensures consistent IDs within a conversation turn.
 */
function makeToolCallId(functionName, index) {
    return `call_${functionName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24)}_${index}`;
}
function buildOpenAIChunk(delta, finishReason, usage) {
    const chunk = {
        id: `chatcmpl-${nextGlobalChunkId()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "antigravity",
        choices: [
            {
                index: 0,
                delta,
                ...(finishReason ? { finish_reason: finishReason } : {}),
            },
        ],
    };
    if (usage) {
        chunk.usage = usage;
    }
    return `data: ${JSON.stringify(chunk)}\n\n`;
}
function buildOpenAIFullResponse(content, model, toolCalls, usage, finishReason) {
    return {
        id: `chatcmpl-${nextGlobalChunkId()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    // Always include content — null when tool calls present, empty string when no text
                    content: content,
                    ...(toolCalls && toolCalls.length > 0
                        ? { tool_calls: toolCalls }
                        : {}),
                },
                finish_reason: finishReason ?? (toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop"),
            },
        ],
        ...(usage ? { usage } : {}),
    };
}
// ---- SSE Transform ----
export function transformSSELine(line) {
    // Skip non-data lines
    if (!line.startsWith("data: "))
        return null;
    const data = line.slice(6).trim();
    if (data === "[DONE]")
        return "data: [DONE]\n\n";
    let payload;
    try {
        payload = JSON.parse(data);
    }
    catch {
        return null;
    }
    const candidate = payload.candidates?.[0];
    if (!candidate) {
        // Could be a usage-only message at the end
        if (payload.usageMetadata) {
            return buildOpenAIChunk({}, null, buildUsage(payload.usageMetadata));
        }
        return null;
    }
    const parts = candidate.content?.parts ?? [];
    const finishReason = mapFinishReason(candidate.finishReason);
    const results = [];
    // Reset tool call tracking on new response (when finishReason is present)
    if (finishReason) {
        currentState.toolCallIndex = 0;
        currentState.toolCallNames = [];
    }
    for (const part of parts) {
        if (part.thought === true) {
            // Reasoning/thinking content
            results.push(buildOpenAIChunk({ reasoning_content: part.text ?? "" }, null));
        }
        else if (part.functionCall) {
            // FIFO tool call ID generation
            const fnName = part.functionCall.name;
            const callId = makeToolCallId(fnName, currentState.toolCallIndex);
            currentState.toolCallNames.push(fnName);
            currentState.toolCallIndex++;
            const argsStr = JSON.stringify(part.functionCall.args);
            results.push(buildOpenAIChunk({
                tool_calls: [
                    {
                        index: currentState.toolCallIndex - 1,
                        id: callId,
                        type: "function",
                        function: {
                            name: fnName,
                            arguments: argsStr,
                        },
                    },
                ],
            }, null));
        }
        else if (typeof part.text === "string") {
            // Regular text content
            results.push(buildOpenAIChunk({ content: part.text }, null));
        }
    }
    // If we have results, add finish + usage as a SEPARATE final chunk
    if (finishReason) {
        results.push(buildOpenAIChunk({}, finishReason, payload.usageMetadata
            ? buildUsage(payload.usageMetadata)
            : undefined));
    }
    else if (payload.usageMetadata && results.length > 0) {
        // Add usage to the last chunk if no finish reason
        const lastIdx = results.length - 1;
        const lastChunk = results[lastIdx];
        const parsedLast = JSON.parse(lastChunk.replace("data: ", "").trim());
        parsedLast.usage = buildUsage(payload.usageMetadata);
        results[lastIdx] = `data: ${JSON.stringify(parsedLast)}\n\n`;
    }
    return results.length > 0 ? results.join("") : null;
}
// ---- Non-Stream Transform ----
export function transformNonStreamResponse(responseText, model) {
    let payload;
    try {
        payload = JSON.parse(responseText);
    }
    catch {
        return JSON.stringify(buildOpenAIFullResponse("", model));
    }
    // Unwrap if response is nested
    const inner = (payload.response ?? payload);
    const candidate = inner.candidates?.[0];
    if (!candidate) {
        return JSON.stringify(buildOpenAIFullResponse("", model));
    }
    const parts = candidate.content?.parts ?? [];
    let contentText = "";
    const toolCalls = [];
    let tcIndex = 0;
    for (const part of parts) {
        if (part.thought === true) {
            // Include thinking content with a marker for non-streaming
            if (part.text) {
                contentText += `[Thinking: ${part.text}]\n`;
            }
        }
        else if (part.functionCall) {
            const callId = makeToolCallId(part.functionCall.name, tcIndex++);
            toolCalls.push({
                id: callId,
                type: "function",
                function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args),
                },
            });
        }
        else if (typeof part.text === "string") {
            contentText += part.text;
        }
    }
    const usage = inner.usageMetadata
        ? buildUsage(inner.usageMetadata)
        : undefined;
    const finishReason = toolCalls.length > 0
        ? "tool_calls"
        : mapFinishReason(candidate.finishReason) ?? "stop";
    return JSON.stringify(buildOpenAIFullResponse(contentText || null, model, toolCalls.length > 0 ? toolCalls : undefined, usage, finishReason));
}
// ---- Streaming TransformStream ----
export function createStreamingTransform() {
    let buffer = "";
    return new TransformStream({
        transform(chunk, controller) {
            buffer += chunk;
            // Process complete SSE lines
            const lines = buffer.split("\n");
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line)
                    continue;
                const transformed = transformSSELine(line);
                if (transformed) {
                    controller.enqueue(transformed);
                }
            }
        },
        flush(controller) {
            // Process any remaining data
            if (buffer.trim()) {
                const transformed = transformSSELine(buffer.trim());
                if (transformed) {
                    controller.enqueue(transformed);
                }
            }
            controller.enqueue("data: [DONE]\n\n");
        },
    });
}
// ---- Helpers ----
function mapFinishReason(reason) {
    if (!reason)
        return null;
    const lower = reason.toLowerCase();
    if (lower === "stop")
        return "stop";
    if (lower === "max_tokens" || lower === "length")
        return "length";
    if (lower.includes("tool") || lower.includes("function"))
        return "tool_calls";
    return "stop";
}
function buildUsage(metadata) {
    return {
        prompt_tokens: metadata.promptTokenCount ?? 0,
        completion_tokens: metadata.candidatesTokenCount ?? 0,
        total_tokens: metadata.totalTokenCount ?? 0,
    };
}
//# sourceMappingURL=response.js.map