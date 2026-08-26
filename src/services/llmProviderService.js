const cooldowns = new Map();

const getNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : fallback;
};

const clip = (value, maxChars) => {
  const text = String(value || "");
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}…`;
};

const isRetryableStatus = (status) =>
  status === 408 ||
  status === 409 ||
  status === 429 ||
  status >= 500;

const getRetryAfterMs = (headers) => {
  const value = headers?.get?.("retry-after");
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.max(0, date - Date.now())
    : 0;
};

const markCooldown = (
  provider,
  ms
) => {
  if (ms > 0) {
    cooldowns.set(
      provider,
      Date.now() + ms
    );
  }
};

const getCooldown = (
  provider
) => {
  const until =
    cooldowns.get(provider) || 0;

  if (until <= Date.now()) {
    cooldowns.delete(provider);
    return 0;
  }

  return until - Date.now();
};

const providerOrder = () =>
  String(
    process.env.LLM_PROVIDER_ORDER ||
      "groq,gemini,huggingface,together,ollama"
  )
    .split(",")
    .map((value) =>
      value.trim().toLowerCase()
    )
    .filter(Boolean);

const hasProviderConfig = (
  provider
) => {
  if (provider === "groq") {
    return Boolean(
      process.env.GROQ_API_KEY
    );
  }

  if (provider === "gemini") {
    return Boolean(
      process.env.GEMINI_API_KEY
    );
  }

  if (provider === "huggingface") {
    return Boolean(
      process.env.HF_API_KEY
    );
  }

  if (provider === "together") {
    return Boolean(
      process.env.TOGETHER_API_KEY
    );
  }

  if (provider === "ollama") {
    return (
      String(
        process.env.LLM_ENABLE_OLLAMA ||
          "false"
      ).toLowerCase() === "true"
    );
  }

  return false;
};

const createTimeout = () => {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () =>
      controller.abort(),
    getNumber(
      process.env.LLM_PROVIDER_TIMEOUT_MS,
      30000
    )
  );

  return {
    controller,
    timeout,
  };
};

const parseJson = (
  body
) => {
  try {
    return JSON.parse(body);
  } catch (_) {
    return null;
  }
};

const buildOpenAIBody = (
  model,
  messages,
  maxTokens,
  jsonMode,
  stream
) => ({
  model,
  messages,
  temperature: 0,
  max_tokens: maxTokens,
  stream,
  ...(jsonMode
    ? {
        response_format: {
          type: "json_object",
        },
      }
    : {}),
});

const callOpenAICompatible = async ({
  provider,
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  jsonMode,
}) => {
  const {
    controller,
    timeout,
  } = createTimeout();

  try {
    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          buildOpenAIBody(
            model,
            messages,
            maxTokens,
            jsonMode,
            false
          )
        ),
        signal:
          controller.signal,
      });

    const retryAfterMs =
      getRetryAfterMs(
        response.headers
      );

    const body =
      await response.text();

    const parsed =
      parseJson(body);

    if (!response.ok) {
      const error =
        new Error(
          parsed?.error?.message ||
            body ||
            `${provider} request failed`
        );

      error.status =
        response.status;
      error.provider =
        provider;
      error.retryable =
        isRetryableStatus(
          response.status
        );
      error.retryAfterMs =
        retryAfterMs;

      throw error;
    }

    const content =
      parsed?.choices?.[0]
        ?.message?.content;

    if (!content) {
      const error =
        new Error(
          `${provider} returned an empty response.`
        );

      error.provider =
        provider;
      error.status = 502;
      error.retryable = true;

      throw error;
    }

    return String(content).trim();
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          `${provider} request timed out.`
        );

      timeoutError.provider =
        provider;
      timeoutError.status = 504;
      timeoutError.retryable = true;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const streamOpenAICompatible = async ({
  provider,
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  jsonMode,
  onToken,
}) => {
  const {
    controller,
    timeout,
  } = createTimeout();

  try {
    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${apiKey}`,
          Accept:
            "text/event-stream",
        },
        body: JSON.stringify(
          buildOpenAIBody(
            model,
            messages,
            maxTokens,
            jsonMode,
            true
          )
        ),
        signal:
          controller.signal,
      });

    const retryAfterMs =
      getRetryAfterMs(
        response.headers
      );

    if (!response.ok) {
      const body =
        await response.text();

      const parsed =
        parseJson(body);

      const error =
        new Error(
          parsed?.error?.message ||
            body ||
            `${provider} streaming request failed`
        );

      error.status =
        response.status;
      error.provider =
        provider;
      error.retryable =
        isRetryableStatus(
          response.status
        );
      error.retryAfterMs =
        retryAfterMs;

      throw error;
    }

    if (!response.body) {
      throw new Error(
        `${provider} did not return a stream.`
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";
    let fullText = "";

    const processLine = (
      line
    ) => {
      const trimmed =
        line.trim();

      if (
        !trimmed ||
        !trimmed.startsWith(
          "data:"
        )
      ) {
        return;
      }

      const data =
        trimmed.slice(5).trim();

      if (data === "[DONE]") {
        return;
      }

      const parsed =
        parseJson(data);

      const token =
        parsed?.choices?.[0]
          ?.delta?.content ||
        "";

      if (token) {
        fullText += token;
        onToken(token);
      }
    };

    while (true) {
      const { value, done } =
        await reader.read();

      if (done) break;

      buffer +=
        decoder.decode(
          value,
          { stream: true }
        );

      const lines =
        buffer.split("\n");

      buffer =
        lines.pop() || "";

      lines.forEach(
        processLine
      );
    }

    if (buffer) {
      processLine(buffer);
    }

    if (!fullText.trim()) {
      throw new Error(
        `${provider} returned an empty stream.`
      );
    }

    return fullText.trim();
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          `${provider} streaming request timed out.`
        );

      timeoutError.provider =
        provider;
      timeoutError.status = 504;
      timeoutError.retryable = true;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const callGemini = async ({
  messages,
  maxTokens,
  jsonMode,
}) => {
  const model =
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";

  const system =
    messages.find(
      (message) =>
        message.role === "system"
    )?.content || "";

  const contents =
    messages
      .filter(
        (message) =>
          message.role !==
          "system"
      )
      .map((message) => ({
        role:
          message.role ===
          "assistant"
            ? "model"
            : "user",
        parts: [
          {
            text: String(
              message.content ||
                ""
            ),
          },
        ],
      }));

  if (system) {
    contents.unshift({
      role: "user",
      parts: [
        {
          text:
            `System instructions:\n${system}`,
        },
      ],
    });
  }

  const {
    controller,
    timeout,
  } = createTimeout();

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(
        process.env.GEMINI_API_KEY
      )}`;

    const body = {
      contents,
      generationConfig: {
        temperature: 0,
        maxOutputTokens:
          maxTokens,
        ...(jsonMode
          ? {
              responseMimeType:
                "application/json",
            }
          : {}),
      },
    };

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(
          body
        ),
        signal:
          controller.signal,
      });

    const retryAfterMs =
      getRetryAfterMs(
        response.headers
      );

    const raw =
      await response.text();

    const parsed =
      parseJson(raw);

    if (!response.ok) {
      const error =
        new Error(
          parsed?.error?.message ||
            raw ||
            "Gemini request failed"
        );

      error.status =
        response.status;
      error.provider =
        "gemini";
      error.retryable =
        isRetryableStatus(
          response.status
        );
      error.retryAfterMs =
        retryAfterMs;

      throw error;
    }

    const content =
      parsed?.candidates?.[0]
        ?.content?.parts
        ?.map(
          (part) =>
            part.text || ""
        )
        .join("")
        .trim();

    if (!content) {
      const error =
        new Error(
          "Gemini returned an empty response."
        );

      error.provider =
        "gemini";
      error.status = 502;
      error.retryable = true;

      throw error;
    }

    return content;
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          "Gemini request timed out."
        );

      timeoutError.provider =
        "gemini";
      timeoutError.status = 504;
      timeoutError.retryable = true;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const streamGemini = async ({
  messages,
  maxTokens,
  jsonMode,
  onToken,
}) => {
  const model =
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";

  const system =
    messages.find(
      (message) =>
        message.role === "system"
    )?.content || "";

  const contents =
    messages
      .filter(
        (message) =>
          message.role !==
          "system"
      )
      .map((message) => ({
        role:
          message.role ===
          "assistant"
            ? "model"
            : "user",
        parts: [
          {
            text: String(
              message.content ||
                ""
            ),
          },
        ],
      }));

  if (system) {
    contents.unshift({
      role: "user",
      parts: [
        {
          text:
            `System instructions:\n${system}`,
        },
      ],
    });
  }

  const {
    controller,
    timeout,
  } = createTimeout();

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
        process.env.GEMINI_API_KEY
      )}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Accept:
            "text/event-stream",
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0,
            maxOutputTokens:
              maxTokens,
            ...(jsonMode
              ? {
                  responseMimeType:
                    "application/json",
                }
              : {}),
          },
        }),
        signal:
          controller.signal,
      });

    const retryAfterMs =
      getRetryAfterMs(
        response.headers
      );

    if (!response.ok) {
      const raw =
        await response.text();

      const parsed =
        parseJson(raw);

      const error =
        new Error(
          parsed?.error?.message ||
            raw ||
            "Gemini streaming request failed"
        );

      error.status =
        response.status;
      error.provider =
        "gemini";
      error.retryable =
        isRetryableStatus(
          response.status
        );
      error.retryAfterMs =
        retryAfterMs;

      throw error;
    }

    if (!response.body) {
      throw new Error(
        "Gemini did not return a stream."
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";
    let fullText = "";

    const processLine = (
      line
    ) => {
      const trimmed =
        line.trim();

      if (
        !trimmed ||
        !trimmed.startsWith(
          "data:"
        )
      ) {
        return;
      }

      const parsed =
        parseJson(
          trimmed
            .slice(5)
            .trim()
        );

      const token =
        parsed?.candidates?.[0]
          ?.content?.parts
          ?.map(
            (part) =>
              part.text || ""
          )
          .join("") || "";

      if (token) {
        fullText += token;
        onToken(token);
      }
    };

    while (true) {
      const { value, done } =
        await reader.read();

      if (done) break;

      buffer +=
        decoder.decode(
          value,
          { stream: true }
        );

      const lines =
        buffer.split("\n");

      buffer =
        lines.pop() || "";

      lines.forEach(
        processLine
      );
    }

    if (buffer) {
      processLine(buffer);
    }

    if (!fullText.trim()) {
      throw new Error(
        "Gemini returned an empty stream."
      );
    }

    return fullText.trim();
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          "Gemini streaming request timed out."
        );

      timeoutError.provider =
        "gemini";
      timeoutError.status = 504;
      timeoutError.retryable = true;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const callOllama = async ({
  messages,
  maxTokens,
  jsonMode,
}) => {
  const baseUrl =
    String(
      process.env.OLLAMA_BASE_URL ||
        "http://localhost:11434"
    ).replace(/\/$/, "");

  const model =
    process.env.OLLAMA_MODEL ||
    "llama3.1:8b";

  const {
    controller,
    timeout,
  } = createTimeout();

  try {
    const response =
      await fetch(
        `${baseUrl}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: {
              temperature: 0,
              num_predict:
                maxTokens,
            },
            ...(jsonMode
              ? {
                  format: "json",
                }
              : {}),
          }),
          signal:
            controller.signal,
        }
      );

    const raw =
      await response.text();

    const parsed =
      parseJson(raw);

    if (!response.ok) {
      const error =
        new Error(
          parsed?.error ||
            raw ||
            "Ollama request failed"
        );

      error.status =
        response.status;
      error.provider =
        "ollama";
      error.retryable =
        response.status >= 500 ||
        response.status === 408;

      throw error;
    }

    const content =
      parsed?.message?.content
        ?.trim();

    if (!content) {
      const error =
        new Error(
          "Ollama returned an empty response."
        );

      error.provider =
        "ollama";
      error.status = 502;
      error.retryable = true;

      throw error;
    }

    return content;
  } catch (error) {
    if (
      error.name ===
      "AbortError"
    ) {
      const timeoutError =
        new Error(
          "Ollama request timed out."
        );

      timeoutError.provider =
        "ollama";
      timeoutError.status = 504;
      timeoutError.retryable = true;

      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const callProvider = async ({
  provider,
  messages,
  maxTokens,
  jsonMode,
}) => {
  if (provider === "groq") {
    return callOpenAICompatible({
      provider,
      url:
        "https://api.groq.com/openai/v1/chat/completions",
      apiKey:
        process.env.GROQ_API_KEY,
      model:
        process.env.GROQ_MODEL ||
        "openai/gpt-oss-20b",
      messages,
      maxTokens,
      jsonMode,
    });
  }

  if (provider === "gemini") {
    return callGemini({
      messages,
      maxTokens,
      jsonMode,
    });
  }

  if (provider === "huggingface") {
    return callOpenAICompatible({
      provider,
      url:
        process.env.HF_BASE_URL ||
        "https://router.huggingface.co/v1/chat/completions",
      apiKey:
        process.env.HF_API_KEY,
      model:
        process.env.HF_MODEL ||
        "Qwen/Qwen2.5-7B-Instruct",
      messages,
      maxTokens,
      jsonMode,
    });
  }

  if (provider === "together") {
    return callOpenAICompatible({
      provider,
      url:
        "https://api.together.xyz/v1/chat/completions",
      apiKey:
        process.env.TOGETHER_API_KEY,
      model:
        process.env.TOGETHER_MODEL ||
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      messages,
      maxTokens,
      jsonMode,
    });
  }

  if (provider === "ollama") {
    return callOllama({
      messages,
      maxTokens,
      jsonMode,
    });
  }

  throw new Error(
    `Unknown LLM provider: ${provider}`
  );
};

const streamProvider = async ({
  provider,
  messages,
  maxTokens,
  jsonMode,
  onToken,
}) => {
  if (
    provider === "groq" ||
    provider === "huggingface" ||
    provider === "together"
  ) {
    const config = {
      groq: {
        url:
          "https://api.groq.com/openai/v1/chat/completions",
        apiKey:
          process.env.GROQ_API_KEY,
        model:
          process.env.GROQ_MODEL ||
          "openai/gpt-oss-20b",
      },
      huggingface: {
        url:
          process.env.HF_BASE_URL ||
          "https://router.huggingface.co/v1/chat/completions",
        apiKey:
          process.env.HF_API_KEY,
        model:
          process.env.HF_MODEL ||
          "Qwen/Qwen2.5-7B-Instruct",
      },
      together: {
        url:
          "https://api.together.xyz/v1/chat/completions",
        apiKey:
          process.env.TOGETHER_API_KEY,
        model:
          process.env.TOGETHER_MODEL ||
          "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      },
    }[provider];

    return streamOpenAICompatible({
      provider,
      ...config,
      messages,
      maxTokens,
      jsonMode,
      onToken,
    });
  }

  if (provider === "gemini") {
    return streamGemini({
      messages,
      maxTokens,
      jsonMode,
      onToken,
    });
  }

  return callProvider({
    provider,
    messages,
    maxTokens,
    jsonMode,
  });
};

const getBudget = ({
  maxTokens,
  task,
}) =>
  getNumber(
    maxTokens,
    getNumber(
      task === "contradiction"
        ? process.env.CONTRADICTION_MAX_COMPLETION_TOKENS
        : process.env.LLM_MAX_COMPLETION_TOKENS,
      task === "contradiction"
        ? 700
        : 600
    )
  );

const completeChat = async ({
  messages,
  maxTokens,
  jsonMode = false,
  task = "chat",
  onToken,
}) => {
  const budget =
    getBudget({
      maxTokens,
      task,
    });

  const errors = [];

  for (
    const provider of providerOrder()
  ) {
    if (
      !hasProviderConfig(
        provider
      )
    ) {
      continue;
    }

    const cooldown =
      getCooldown(provider);

    if (cooldown > 0) {
      errors.push(
        `${provider}: cooldown ${Math.ceil(
          cooldown / 1000
        )}s`
      );
      continue;
    }

    try {
      let content;

      if (typeof onToken === "function") {
        content =
          await streamProvider({
            provider,
            messages,
            maxTokens:
              budget,
            jsonMode,
            onToken,
          });
      } else {
        content =
          await callProvider({
            provider,
            messages,
            maxTokens:
              budget,
            jsonMode,
          });
      }

      console.log(
        `LLM provider used for ${task}: ${provider}`
      );

      return {
        content,
        provider,
      };
    } catch (error) {
      if (error.retryable) {
        const cooldownMs =
          Math.max(
            error.retryAfterMs || 0,
            getNumber(
              process.env.LLM_PROVIDER_COOLDOWN_MS,
              15000
            )
          );

        markCooldown(
          provider,
          cooldownMs
        );
      }

      errors.push(
        `${provider}: ${clip(
          error.message,
          220
        )}`
      );

      if (!error.retryable) {
        throw error;
      }
    }
  }

  const error =
    new Error(
      `No configured LLM provider is currently available. ${errors.join(
        " | "
      )}`
    );

  error.code =
    "LLM_PROVIDER_EXHAUSTED";
  error.status = 429;

  throw error;
};

module.exports = {
  completeChat,
};
