import { NextRequest, NextResponse } from 'next/server';
import { parseCSV } from '@/lib/csvParser';
import { classifyTransactions } from '@/lib/gemini';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { csv } = await req.json();

    if (!csv || typeof csv !== 'string') {
      return NextResponse.json({ error: 'No CSV data provided.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server configuration error: missing API key.' }, { status: 500 });
    }

    const transactions = parseCSV(csv);
    const classified = await classifyTransactions(transactions, apiKey);

    return NextResponse.json({ transactions: classified });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    console.error('[TaxSort] Gemini error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
