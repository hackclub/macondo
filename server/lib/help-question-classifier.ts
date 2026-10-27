import { useRuntimeConfig } from "#imports";

import { aiChat, getDefaultAiModel } from "./hackclub-ai";

// Fails closed (false on any error or non-YES): better to miss a ticket than spam the staff channel.
export async function classifyAsHelpQuestion(text: string): Promise<boolean> {
  if (!text || text.trim().length < 3) return false;

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) return false;

  const systemPrompt = [
    "You classify short Slack messages.",
    "The user will give you one message. Reply with EXACTLY one word: YES or NO.",
    "YES if the message is a genuine help request, question, or bug report about the Macondo site, farming game, onboarding, code, account, or tools.",
    "NO if the message is a mention, greeting, announcement, compliment, meme, or unrelated.",
    "Do not explain. Do not include punctuation. Output only YES or NO.",
  ].join("\n");

  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        max_tokens: 5,
      },
    });
    return (res.choices?.[0]?.message?.content ?? "").trim().toUpperCase().startsWith("YES");
  } catch (err) {
    console.warn("[help-question-classifier] ai.hackclub.com call failed", err);
    return false;
  }
}
