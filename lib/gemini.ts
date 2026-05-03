import { GoogleGenerativeAI } from '@google/generative-ai';
import { CATEGORIES, CATEGORY_KEYS } from './categories';
import type { RawTransaction } from './csvParser';

export interface ClassifiedTransaction extends RawTransaction {
  category: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

const SYSTEM_PROMPT = `You are an Australian tax specialist for sole traders. Classify each bank transaction into the correct ATO tax deduction category.

CATEGORIES (use the exact key string):
${CATEGORIES.map((c) => `- "${c.key}": ${c.label} — ${c.description}\n  Examples: ${c.examples.join(', ')}`).join('\n')}

RULES:
- Use "not_deductible" for personal expenses, entertainment, ATO tax payments, or income credits
- Use "needs_review" for ambiguous merchants (Woolworths, Coles, Uber, Amazon, eBay, ATM, cash)
- Fuel stations (Caltex, BP, Shell, Ampol, 7-Eleven) → "motor_vehicle" at HIGH confidence
- Telco bills (Telstra, Optus, Vodafone) → "phone_internet" at HIGH confidence
- SaaS tools (Xero, Adobe, AWS, Microsoft) → "software_subscriptions" at HIGH confidence
- Bank monthly/transaction fees → "bank_charges" at HIGH confidence
- Bunnings Warehouse → "repairs_maintenance" at MEDIUM confidence (hardware/trade supplies)
- ATO, Australian Tax Office payments → "not_deductible"
- Positive amounts (credits/income) → "not_deductible" with note "Income – not a deductible expense"
- Only classify expenses that are outflows for a business

Return ONLY a raw JSON array. No markdown fences, no explanation, just JSON.
Format: [{"id":"...","category":"...","confidence":"high|medium|low","notes":"..."}]`;

const BATCH_SIZE = 25;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function safeParseJSON(text: string): { id: string; category: string; confidence: string; notes: string }[] {
  const cleaned = text
    .trim()
    // Strip thinking blocks (Gemini 2.5 Flash with thinking enabled)
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    // Strip markdown fences
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: pull out the first [...] array found anywhere in the response
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 120)}`);
  }
}

export async function classifyTransactions(
  transactions: RawTransaction[],
  apiKey: string
): Promise<ClassifiedTransaction[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const batches = chunkArray(transactions, BATCH_SIZE);
  const results: ClassifiedTransaction[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    // Respect 5 RPM limit — wait 13s between batches
    if (i > 0) await new Promise((r) => setTimeout(r, 13000));

    const prompt = `Classify these transactions:\n${JSON.stringify(
      batch.map((t) => ({ id: t.id, date: t.date, description: t.description, amount: t.amount }))
    )}`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const parsed = safeParseJSON(text);

    for (const item of parsed) {
      const original = batch.find((t) => t.id === item.id);
      if (!original) continue;

      const category = CATEGORY_KEYS.includes(item.category) ? item.category : 'needs_review';
      const confidence = ['high', 'medium', 'low'].includes(item.confidence)
        ? (item.confidence as 'high' | 'medium' | 'low')
        : 'low';

      results.push({ ...original, category, confidence, notes: item.notes ?? '' });
    }
  }

  // Fallback for any transactions Gemini missed
  for (const t of transactions) {
    if (!results.find((r) => r.id === t.id)) {
      results.push({ ...t, category: 'needs_review', confidence: 'low', notes: 'Could not classify – please review manually' });
    }
  }

  return results.sort((a, b) => Number(a.id) - Number(b.id));
}
