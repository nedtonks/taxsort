import Papa from 'papaparse';

export interface RawTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
}

type ParsedRow = Record<string, string>;

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumn(headers: string[], candidates: string[]): string | null {
  const normalised = headers.map(normaliseHeader);
  for (const candidate of candidates) {
    const idx = normalised.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function detectFormat(headers: string[]): 'westpac' | 'standard' {
  const normalised = headers.map(normaliseHeader);
  if (normalised.includes('debit') && normalised.includes('credit')) return 'westpac';
  return 'standard';
}

export function parseCSV(csvText: string): RawTransaction[] {
  const result = Papa.parse<ParsedRow>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (!result.data.length) throw new Error('CSV appears to be empty or could not be parsed.');

  const headers = Object.keys(result.data[0]);
  const format = detectFormat(headers);

  const dateCol = findColumn(headers, ['date', 'transactiondate', 'valuedate']);
  const descCol = findColumn(headers, ['description', 'particulars', 'narrative', 'details', 'memo', 'transactiondescription', 'text']);

  if (!dateCol || !descCol) {
    throw new Error('Could not detect date or description columns. Please ensure your CSV has Date and Description columns.');
  }

  const transactions: RawTransaction[] = [];

  result.data.forEach((row, i) => {
    const date = row[dateCol]?.trim() ?? '';
    const description = row[descCol]?.trim() ?? '';
    if (!date || !description) return;

    let amount = 0;

    if (format === 'westpac') {
      const debitCol = findColumn(headers, ['debit', 'withdrawal', 'debitamount']);
      const creditCol = findColumn(headers, ['credit', 'deposit', 'creditamount']);
      const debit = debitCol ? parseAmount(row[debitCol]) : 0;
      const credit = creditCol ? parseAmount(row[creditCol]) : 0;
      // Debits are outflows (negative), credits are inflows (positive)
      amount = credit > 0 ? credit : -Math.abs(debit);
    } else {
      const amountCol = findColumn(headers, ['amount', 'transactionamount', 'value', 'net']);
      amount = amountCol ? parseAmount(row[amountCol]) : 0;
    }

    transactions.push({ id: String(i + 1), date, description, amount });
  });

  if (!transactions.length) throw new Error('No valid transactions found in the CSV.');

  return transactions;
}
